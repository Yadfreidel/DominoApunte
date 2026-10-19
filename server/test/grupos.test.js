// Grupos, invitaciones, roles, temporadas (clasificación, desempates, cierre) y pantalla grande.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { computeStandings, seasonStatus } from '../src/season.js';

let server;
let base;
let db;
let clockIso = '2026-10-19T15:00:00.000Z';
const tk = {};
const PASS = 'clave-segura-123';

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Partida individual o por parejas que termina con victoria del lado `winner`. */
function game(id, names, winner, { mode, groupId, seasonId, at = '2026-10-19T14:00:00.000Z', practice = false, points = 100 } = {}) {
  const parejas = (mode ?? (names.length === 4 ? 'parejas' : 'individual')) === 'parejas';
  const participants = names.map((name, i) => ({ id: `p${i}`, name }));
  const sides = parejas
    ? [
        { id: 's0', name: `${names[0]} y ${names[1]}`, participantIds: ['p0', 'p1'] },
        { id: 's1', name: `${names[2]} y ${names[3]}`, participantIds: ['p2', 'p3'] },
      ]
    : participants.map((p, i) => ({ id: `s${i}`, name: p.name, participantIds: [p.id] }));
  return {
    id,
    createdAt: at,
    updatedAt: at,
    finishedAt: null,
    status: 'pendiente',
    mode: parejas ? 'parejas' : 'individual',
    target: 100,
    participants,
    sides,
    hands: winner == null ? [] : [{ id: `${id}-h`, sideId: `s${winner}`, points, createdAt: at }],
    winnerSideId: null,
    rematchOf: null,
    revision: 1,
    practice,
    groupId,
    seasonId,
  };
}

before(async () => {
  db = await openDatabase({ dataDir: 'memory' });
  for (const [u, role] of [
    ['ana', 'anotador'],
    ['beto', 'anotador'],
    ['caro', 'anotador'],
    ['dani', 'anotador'],
    ['jefa', 'admin'],
  ]) {
    await db.run('INSERT INTO domino.users (username, password_hash, role, active, created_at) VALUES ($1, $2, $3, 1, $4)', [u, hashPassword(PASS), role, clockIso]);
  }
  const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex'), clock: () => clockIso });
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const u of ['ana', 'beto', 'caro', 'dani', 'jefa']) tk[u] = (await api('/auth/login', { method: 'POST', body: { username: u, password: PASS } })).data.token;
});
after(() => server?.close());

let groupId;
let seasonId;

describe('grupos e invitaciones', () => {
  test('crear un grupo: quien lo crea es propietario; los demás no lo ven', async () => {
    const r = await api('/groups', { method: 'POST', token: tk.ana, body: { name: 'Dominó de los viernes', description: 'En casa de Ana', timezone: 'America/Santo_Domingo' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.group.myRole, 'propietario');
    groupId = r.data.group.id;
    assert.equal((await api('/groups', { token: tk.ana })).data.groups.length, 1);
    assert.equal((await api('/groups', { token: tk.beto })).data.groups.length, 0);
    assert.equal((await api(`/groups/${groupId}`, { token: tk.beto })).status, 404, 'un grupo privado no se revela');
    assert.equal((await api(`/groups/${groupId}/games`, { token: tk.beto })).status, 404);
    assert.equal((await api(`/groups/${groupId}`, { token: tk.jefa })).status, 404, 'ser administrador de la app no da acceso a grupos privados');
    assert.equal((await api('/groups')).status, 401);
  });

  test('invitar por código: unirse, revocar, vencer y no adivinar', async () => {
    const inv = await api(`/groups/${groupId}/invites`, { method: 'POST', token: tk.ana, body: {} });
    assert.equal(inv.status, 201);
    assert.match(inv.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const stored = await db.get('SELECT code_hash FROM domino.group_invites WHERE id = $1', [inv.data.invite.id]);
    assert.notEqual(stored.code_hash, inv.data.code, 'solo se guarda el hash');
    assert.equal((await api(`/groups/${groupId}/invites`, { method: 'POST', token: tk.beto, body: {} })).status, 404, 'quien no es integrante no puede invitar');
    const join = await api('/groups/join', { method: 'POST', token: tk.beto, body: { code: inv.data.code.toLowerCase().replace('-', ' ') } });
    assert.equal(join.status, 200);
    assert.equal(join.data.group.myRole, 'miembro');
    assert.equal((await api('/groups/join', { method: 'POST', token: tk.beto, body: { code: inv.data.code } })).status, 200, 'unirse dos veces no duplica');
    const members = (await api(`/groups/${groupId}`, { token: tk.beto })).data.members;
    assert.equal(members.length, 2);
    assert.equal((await api(`/groups/${groupId}/invites`, { method: 'POST', token: tk.beto, body: {} })).status, 403, 'un miembro no invita');
    assert.equal((await api(`/groups/${groupId}/invites/${inv.data.invite.id}`, { method: 'DELETE', token: tk.ana })).status, 204);
    assert.equal((await api('/groups/join', { method: 'POST', token: tk.caro, body: { code: inv.data.code } })).status, 404, 'invitación revocada');
    assert.equal((await api('/groups/join', { method: 'POST', token: tk.caro, body: { code: 'AAAA-BBBB' } })).status, 404);
    const fresh = await api(`/groups/${groupId}/invites`, { method: 'POST', token: tk.ana, body: { days: 1 } });
    clockIso = '2026-10-21T15:00:00.000Z';
    assert.equal((await api('/groups/join', { method: 'POST', token: tk.caro, body: { code: fresh.data.code } })).status, 404, 'invitación vencida');
    clockIso = '2026-10-19T15:00:00.000Z';
    await db.run("UPDATE domino.group_invites SET expires_at = '2026-10-30T00:00:00.000Z' WHERE id = $1", [fresh.data.invite.id]);
    assert.equal((await api('/groups/join', { method: 'POST', token: tk.caro, body: { code: fresh.data.code } })).status, 200);
  });

  test('roles: solo el propietario los cambia y el grupo nunca queda sin propietario', async () => {
    const ids = Object.fromEntries((await db.all('SELECT id, username FROM domino.users')).map((u) => [u.username, u.id]));
    assert.equal((await api(`/groups/${groupId}/members/${ids.caro}/role`, { method: 'POST', token: tk.beto, body: { role: 'admin' } })).status, 403);
    assert.equal((await api(`/groups/${groupId}/members/${ids.beto}/role`, { method: 'POST', token: tk.ana, body: { role: 'admin' } })).status, 204);
    assert.equal((await api(`/groups/${groupId}/members/${ids.ana}/role`, { method: 'POST', token: tk.ana, body: { role: 'miembro' } })).status, 409, 'último propietario');
    assert.equal((await api(`/groups/${groupId}/leave`, { method: 'POST', token: tk.ana })).status, 409, 'el único propietario no puede salir');
    assert.equal((await api(`/groups/${groupId}/members/${ids.ana}`, { method: 'DELETE', token: tk.beto })).status, 403, 'un admin no quita al propietario');
    assert.equal((await api(`/groups/${groupId}/members/${ids.caro}`, { method: 'DELETE', token: tk.beto })).status, 204, 'un admin quita a un miembro');
    assert.equal((await api(`/groups/${groupId}`, { token: tk.caro })).status, 404, 'quien sale pierde el acceso');
  });
});

describe('partidas del grupo y temporadas', () => {
  test('crear temporada (solo admin del grupo) con reglas visibles', async () => {
    const bad = await api(`/groups/${groupId}/seasons`, { method: 'POST', token: tk.ana, body: { name: 'X', startsOn: '2026-10-30', endsOn: '2026-10-01', ranking: 'individual', modes: ['individual'] } });
    assert.equal(bad.status, 400);
    const r = await api(`/groups/${groupId}/seasons`, {
      method: 'POST',
      token: tk.beto,
      body: { name: 'Otoño 2026', startsOn: '2026-10-15', endsOn: '2026-10-25', ranking: 'individual', modes: ['individual'], rules: { winPoints: 3, lossPoints: 1 } },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.season.status, 'activa');
    assert.deepEqual(r.data.season.rules, { winPoints: 3, lossPoints: 1 });
    seasonId = r.data.season.id;
    const change = await api(`/seasons/${seasonId}`, { method: 'PATCH', token: tk.ana, body: { rules: { winPoints: 5, lossPoints: 0 } } });
    assert.equal(change.status, 409, 'las reglas no cambian después de empezar');
    assert.equal((await api(`/seasons/${seasonId}`, { method: 'PATCH', token: tk.ana, body: { name: 'Otoño' } })).status, 200);
  });

  test('asociar partidas: solo integrantes, solo temporadas válidas y sin cambiar después', async () => {
    const games = [
      game('t1', ['Juan', 'Luis'], 0, { groupId, seasonId }),
      game('t2', ['Juan', 'Pedro'], 0, { groupId, seasonId }),
      game('t3', ['Luis', 'Pedro'], 0, { groupId, seasonId }),
      game('t4', ['Pedro', 'Juan'], 0, { groupId, seasonId }),
      game('t5', ['Juan', 'Luis'], 1, { groupId, seasonId, practice: true }), // práctica: no cuenta
      game('t6', ['Ana', 'Luis', 'Juan', 'Pedro'], 0, { groupId, seasonId }), // parejas: modalidad no admitida
    ];
    const r = await api('/sync/games', { method: 'POST', token: tk.ana, body: { games } });
    assert.equal(r.data.accepted.length, 6);
    assert.ok(r.data.warnings.some((w) => w.id === 't6'), 'avisa que la modalidad no está admitida');
    assert.ok(r.data.warnings.some((w) => w.id === 't5'));
    const t6 = await db.get("SELECT group_id, season_id FROM domino.games WHERE id = 't6'");
    assert.deepEqual(t6, { group_id: groupId, season_id: null });
    const intruder = await api('/sync/games', { method: 'POST', token: tk.dani, body: { games: [game('x1', ['Zoe', 'Rita'], 0, { groupId, seasonId })] } });
    assert.ok(intruder.data.warnings[0].warning.includes('No perteneces'));
    assert.deepEqual(await db.get("SELECT group_id, season_id FROM domino.games WHERE id = 'x1'"), { group_id: null, season_id: null });
    // Volver a sincronizar con otra temporada no cambia la asociación.
    await api('/sync/games', { method: 'POST', token: tk.ana, body: { games: [{ ...games[0], revision: 5, seasonId: null, groupId: null }] } });
    assert.deepEqual(await db.get("SELECT group_id, season_id FROM domino.games WHERE id = 't1'"), { group_id: groupId, season_id: seasonId });
  });

  test('clasificación: puntos de clasificación (no puntos de manos) y campeón', async () => {
    const r = await api(`/seasons/${seasonId}`, { token: tk.beto });
    assert.equal(r.status, 200);
    const rows = r.data.standings.rows;
    const byName = Object.fromEntries(rows.map((x) => [x.name, x]));
    // Juan: ganó t1, t2; perdió t4 → 3+3+1 = 7. Pedro: perdió t2, t3; ganó t4 → 1+1+3 = 5. Luis: perdió t1, ganó t3 → 1+3 = 4.
    assert.equal(byName.Juan.points, 7);
    assert.equal(byName.Pedro.points, 5);
    assert.equal(byName.Luis.points, 4);
    assert.equal(byName.Juan.position, 1);
    assert.deepEqual(r.data.standings.champions.map((c) => c.name), ['Juan']);
    assert.equal(r.data.standings.games, 4, 'práctica y modalidad no admitida no cuentan');
    assert.equal((await api(`/seasons/${seasonId}`, { token: tk.dani })).status, 404, 'quien no es integrante no ve la temporada');
  });

  test('empate persistente: campeones compartidos', () => {
    const season = { id: 'S', startsOn: '2026-01-01', endsOn: '2026-12-31', timezone: 'UTC', modes: ['individual'], ranking: 'individual', rules: { winPoints: 3, lossPoints: 0 } };
    const mk = (id, w, l) => ({
      id,
      seasonId: 'S',
      status: 'terminada',
      winnerSideId: 'a',
      createdAt: '2026-05-01T10:00:00Z',
      finishedAt: '2026-05-01T11:00:00Z',
      mode: 'individual',
      practice: false,
      participants: [
        { id: 'pa', name: w, serverPlayerId: w },
        { id: 'pb', name: l, serverPlayerId: l },
      ],
      sides: [
        { id: 'a', participantIds: ['pa'] },
        { id: 'b', participantIds: ['pb'] },
      ],
      hands: [{ sideId: 'a', points: 100 }],
    });
    const sidePlayers = (g, side) => side.participantIds.map((pid) => g.participants.find((p) => p.id === pid)).map((p) => ({ id: p.serverPlayerId, name: p.name }));
    // A le gana a B y B le gana a A con el mismo marcador: empate total.
    const st = computeStandings(season, [mk('1', 'A', 'B'), mk('2', 'B', 'A')], sidePlayers);
    assert.deepEqual(st.champions.map((c) => c.name).sort(), ['A', 'B']);
    assert.ok(st.rows.every((r) => r.position === 1 && r.tied));
    // Desempate por enfrentamiento directo: A y B empatan a 6 puntos, pero A le ganó a B.
    const h2h = computeStandings(season, [mk('3', 'A', 'B'), mk('4', 'A', 'C'), mk('5', 'B', 'C'), mk('6', 'B', 'D'), mk('7', 'C', 'A')], sidePlayers);
    const pos = Object.fromEntries(h2h.rows.map((r) => [r.name, r.position]));
    assert.equal(h2h.rows.find((r) => r.name === 'A').points, h2h.rows.find((r) => r.name === 'B').points);
    assert.ok(pos.A < pos.B, 'A queda delante por haberle ganado a B');
  });

  test('cierre: bloquea incorporaciones, finaliza una sola vez y registra correcciones posteriores', async () => {
    clockIso = '2026-10-26T15:00:00.000Z'; // día siguiente al cierre: cerrada, aún no finalizada
    const late = await api('/sync/games', { method: 'POST', token: tk.ana, body: { games: [game('t7', ['Luis', 'Juan'], 0, { groupId, seasonId, at: '2026-10-26T14:00:00.000Z' })] } });
    assert.ok(late.data.warnings.some((w) => w.id === 't7'), 'una partida nueva tras la fecha final no se incorpora');
    const s1 = await api(`/seasons/${seasonId}`, { token: tk.ana });
    assert.equal(s1.data.season.status, 'cerrada');
    assert.equal(s1.data.season.final, null);
    clockIso = '2026-10-28T06:00:00.000Z';
    assert.equal((await api('/cron/seasons')).status, 401, 'el cierre automático exige el secreto');
    process.env.CRON_SECRET = 'secreto-de-prueba';
    const cron = await api('/cron/seasons', { headers: { authorization: 'Bearer secreto-de-prueba' } });
    assert.equal(cron.status, 200);
    assert.equal(cron.data.updated, 1);
    const again = await api('/cron/seasons', { headers: { authorization: 'Bearer secreto-de-prueba' } });
    assert.equal(again.data.updated, 0, 'idempotente');
    const s2 = (await api(`/seasons/${seasonId}`, { token: tk.ana })).data.season;
    assert.equal(s2.status, 'finalizada');
    assert.deepEqual(s2.final.champions.map((c) => c.name), ['Juan']);
    // Corrección autorizada posterior: t1 en realidad la ganó Luis.
    const fix = await api('/admin/games/t1/hands/t1-h', { method: 'DELETE', token: tk.jefa, body: { reason: 'Acta corregida' } });
    assert.equal(fix.status, 200);
    const s3 = (await api(`/seasons/${seasonId}`, { token: tk.ana })).data.season;
    assert.equal(s3.final.revisions.length, 2, 'la corrección queda registrada');
    assert.match(s3.final.revisions[1].reason, /corrección/);
    delete process.env.CRON_SECRET;
    clockIso = '2026-10-19T15:00:00.000Z';
  });

  test('estado según la zona horaria del grupo', () => {
    const s = { startsOn: '2026-10-20', endsOn: '2026-10-20', timezone: 'America/Santo_Domingo' };
    assert.equal(seasonStatus(s, '2026-10-20T02:00:00Z'), 'programada', 'en Santo Domingo todavía es 19');
    assert.equal(seasonStatus(s, '2026-10-20T12:00:00Z'), 'activa');
    assert.equal(seasonStatus(s, '2026-10-21T12:00:00Z'), 'cerrada');
    assert.equal(seasonStatus(s, '2026-10-23T12:00:00Z'), 'finalizada');
  });
});

describe('pantalla grande', () => {
  let token;
  test('el dueño crea un enlace de espectador; otros no', async () => {
    assert.equal((await api('/games/t2/spectator', { method: 'POST', token: tk.beto })).status, 403);
    assert.equal((await api('/games/no-existe/spectator', { method: 'POST', token: tk.ana })).status, 404);
    const r = await api('/games/t2/spectator', { method: 'POST', token: tk.ana });
    assert.equal(r.status, 201);
    token = r.data.token;
    assert.ok(token.length >= 32);
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM domino.spectator_links WHERE token_hash = $1', [token])).n, 0, 'solo se guarda el hash');
  });

  test('el espectador ve el marcador sin datos privados y se actualiza', async () => {
    const v = await api(`/spectate/${token}`);
    assert.equal(v.status, 200);
    assert.equal(v.data.target, 100);
    assert.equal(v.data.sides.length, 2);
    assert.equal(v.data.sides[0].total, 100);
    assert.equal(v.data.lastHand.points, 100);
    const text = JSON.stringify(v.data);
    for (const secret of [groupId, seasonId, 'ana', 'source_user', 'ownerUserId', 'groupId']) assert.ok(!text.includes(secret), `no expone ${secret}`);
    // Un cambio sincronizado se ve en la siguiente consulta (revisión mayor).
    const g2 = game('t2', ['Juan', 'Pedro'], 0, { groupId, seasonId });
    g2.hands.push({ id: 't2-h2', sideId: 's1', points: 15, createdAt: g2.createdAt });
    g2.revision = 3;
    await api('/sync/games', { method: 'POST', token: tk.ana, body: { games: [g2] } });
    const v2 = await api(`/spectate/${token}`);
    assert.ok(v2.data.revision > v.data.revision);
    assert.equal(v2.data.lastHand.points, 15);
    assert.equal(v2.data.lastHand.number, 2);
  });

  test('revocar el enlace y tokens inválidos', async () => {
    assert.equal((await api(`/spectate/${'x'.repeat(32)}`)).status, 404);
    assert.equal((await api('/games/t2/spectator', { method: 'DELETE', token: tk.ana })).data.revoked, 1);
    assert.equal((await api(`/spectate/${token}`)).status, 404);
  });
});
