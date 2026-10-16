// Panel de administración privado: permisos, papelera, fusiones, torneos, auditoría,
// exportación, reglas, identidad visual, apariencia y recuperación de contraseña.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { contrastProblems } from '../src/validation.js';

let server;
let base;
let db;
const tokens = {};
const sentMail = [];
const PASS = { owner: randomBytes(12).toString('hex'), admin: randomBytes(12).toString('hex'), mesa: randomBytes(12).toString('hex'), mesa2: randomBytes(12).toString('hex') };
const T = '2026-10-20T20:00:00.000Z';

async function api(path, { method = 'GET', token, body, raw = false } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: raw ? text : text ? JSON.parse(text) : null };
}

/** PNG real de w×h píxeles (para probar la validación de imágenes). */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

const clientKey = (name) => name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

function game(id, names, hands, overrides = {}) {
  const participants = names.map((name, i) => ({ id: `p${i}`, name, playerId: `c-${clientKey(name)}` }));
  return {
    id,
    createdAt: T,
    updatedAt: T,
    finishedAt: null,
    status: 'pendiente',
    mode: 'individual',
    target: 100,
    participants,
    sides: participants.map((p, i) => ({ id: `s${i}`, name: p.name, participantIds: [p.id] })),
    hands: hands.map(([side, points], i) => ({ id: `${id}-h${i}`, sideId: side, points, createdAt: T })),
    winnerSideId: null,
    rematchOf: null,
    revision: hands.length + 1,
    ...overrides,
  };
}

before(async () => {
  db = await openDatabase({ dataDir: 'memory' });
  const insert = (username, email, role, pass) =>
    db.run('INSERT INTO domino.users (username, email, password_hash, role, active, created_at) VALUES ($1, $2, $3, $4, 1, $5)', [
      username,
      email,
      hashPassword(pass),
      role,
      T,
    ]);
  await insert('duena', 'duena@example.com', 'propietario', PASS.owner);
  await insert('ayudante', 'ayudante@example.com', 'admin', PASS.admin);
  await insert('mesa', null, 'anotador', PASS.mesa);
  await insert('mesa2', null, 'anotador', PASS.mesa2);
  const mailer = { configured: true, appUrl: 'https://app.example.com', send: async (m) => sentMail.push(m) };
  const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex'), mailer });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server?.close());

describe('acceso privado', () => {
  test('inicio de sesión con correo; el propietario y el administrador entran al panel', async () => {
    const owner = await api('/auth/login', { method: 'POST', body: { email: 'DUENA@example.com', password: PASS.owner } });
    assert.equal(owner.status, 200);
    assert.equal(owner.data.user.role, 'propietario');
    assert.equal(owner.data.user.password_hash, undefined);
    tokens.owner = owner.data.token;
    tokens.admin = (await api('/auth/login', { method: 'POST', body: { email: 'ayudante@example.com', password: PASS.admin } })).data.token;
    tokens.mesa = (await api('/auth/login', { method: 'POST', body: { username: 'mesa', password: PASS.mesa } })).data.token;
    tokens.mesa2 = (await api('/auth/login', { method: 'POST', body: { username: 'mesa2', password: PASS.mesa2 } })).data.token;
    assert.equal((await api('/admin/summary', { token: tokens.owner })).status, 200);
    assert.equal((await api('/admin/summary', { token: tokens.admin })).status, 200);
  });

  test('un usuario normal no puede ejecutar ninguna acción administrativa', async () => {
    const calls = [
      ['GET', '/admin/summary'],
      ['GET', '/admin/players'],
      ['POST', '/admin/players/merge'],
      ['GET', '/admin/trash'],
      ['DELETE', '/admin/trash/games/x'],
      ['POST', '/admin/tournaments'],
      ['PATCH', '/admin/tournaments/x'],
      ['PUT', '/admin/settings'],
      ['PUT', '/admin/appearance'],
      ['PUT', '/admin/branding'],
      ['GET', '/admin/audit'],
      ['GET', '/admin/export/partidas'],
      ['POST', '/admin/tests/cleanup'],
      ['POST', '/admin/users'],
    ];
    for (const [method, path] of calls) {
      const r = await api(path, { method, token: tokens.mesa, body: method === 'GET' ? undefined : { reason: 'intento' } });
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal((await api(path, { method, body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${path} sin sesión`);
    }
  });

  test('no hay registro público ni forma de nombrarse propietario desde la app', async () => {
    assert.equal((await api('/auth/register', { method: 'POST', body: { email: 'x@y.com' } })).status, 404);
    const r = await api('/admin/users', { method: 'POST', token: tokens.owner, body: { username: 'otro', password: 'x'.repeat(12), role: 'propietario' } });
    assert.equal(r.status, 400);
    const users = (await api('/admin/users', { token: tokens.owner })).data.users;
    const mesa = users.find((u) => u.username === 'mesa');
    const promote = await api(`/admin/users/${mesa.id}`, { method: 'PATCH', token: tokens.owner, body: { role: 'propietario', reason: 'intento' } });
    assert.equal(promote.status, 400);
  });

  test('un administrador no puede crear administradores ni tocar la cuenta del propietario', async () => {
    const r = await api('/admin/users', { method: 'POST', token: tokens.admin, body: { username: 'jefe2', password: 'x'.repeat(12), role: 'admin' } });
    assert.equal(r.status, 403);
    const users = (await api('/admin/users', { token: tokens.admin })).data.users;
    const owner = users.find((u) => u.role === 'propietario');
    const lock = await api(`/admin/users/${owner.id}`, { method: 'PATCH', token: tokens.admin, body: { active: false, reason: 'intento' } });
    assert.equal(lock.status, 403);
    const ok = await api('/admin/users', { method: 'POST', token: tokens.admin, body: { username: 'mesa3', email: 'mesa3@example.com', password: 'x'.repeat(12), role: 'anotador' } });
    assert.equal(ok.status, 201);
  });

  test('recuperación de contraseña: respuesta genérica, enlace de un solo uso y cierre de sesiones', async () => {
    const unknown = await api('/auth/forgot', { method: 'POST', body: { email: 'nadie@example.com' } });
    assert.equal(unknown.status, 200);
    assert.equal(sentMail.length, 0);
    const known = await api('/auth/forgot', { method: 'POST', body: { email: 'ayudante@example.com' } });
    assert.equal(known.data.message, unknown.data.message, 'misma respuesta exista o no la cuenta');
    assert.equal(sentMail.length, 1);
    const token = /token=([A-Za-z0-9_-]+)/.exec(sentMail[0].text)[1];
    const stored = await db.get('SELECT token_hash FROM domino.password_resets');
    assert.notEqual(stored.token_hash, token, 'solo se guarda el hash');
    const weak = await api('/auth/reset', { method: 'POST', body: { token, password: 'corta' } });
    assert.equal(weak.status, 400);
    const newPass = randomBytes(10).toString('hex');
    assert.equal((await api('/auth/reset', { method: 'POST', body: { token, password: newPass } })).status, 200);
    assert.equal((await api('/auth/reset', { method: 'POST', body: { token, password: newPass } })).status, 400, 'no se reutiliza');
    assert.equal((await api('/auth/me', { token: tokens.admin })).status, 401, 'la sesión anterior se cerró');
    tokens.admin = (await api('/auth/login', { method: 'POST', body: { email: 'ayudante@example.com', password: newPass } })).data.token;
    assert.ok(tokens.admin);
  });
});

describe('partidas del usuario y valores predeterminados', () => {
  test('cada cuenta solo modifica sus propias partidas; el administrador puede todas', async () => {
    const g = game('mia', ['Rosa', 'Tito'], [['s0', 30]]);
    assert.equal((await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [g] } })).data.accepted.length, 1);
    const stolen = await api('/sync/games', { method: 'POST', token: tokens.mesa2, body: { games: [{ ...g, revision: 99, hands: [] }] } });
    assert.equal(stolen.data.accepted.length, 0);
    assert.match(stolen.data.errors[0].error, /otra cuenta/);
    const mine = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [{ ...g, revision: 5, hands: [...g.hands, { id: 'mia-x', sideId: 's1', points: 10, createdAt: T }] }] } });
    assert.equal(mine.data.accepted.length, 1);
  });

  test('cambiar las reglas predeterminadas no altera partidas existentes ni en curso', async () => {
    const g = game('con-reglas', ['Rosa', 'Tito'], [['s0', 20]], { target: 150, rules: { passPoints: 20 } });
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [g] } });
    const put = await api('/admin/settings', {
      method: 'PUT',
      token: tokens.owner,
      body: { defaultTargets: [200, 300], defaultTarget: 300, defaultMode: 'parejas', rules: { passPoints: 50 } },
    });
    assert.equal(put.status, 200);
    const stored = (await api('/admin/games/con-reglas', { token: tokens.owner })).data.game;
    assert.equal(stored.target, 150);
    assert.deepEqual(stored.rules, { passPoints: 20 });
    const pub = await api('/public/config');
    assert.equal(pub.status, 200);
    assert.equal(pub.data.settings.defaultTarget, 300);
    assert.equal(pub.data.settings.rules.passPoints, 50);
    // El usuario sigue eligiendo: una partida nueva con otra meta y modalidad se acepta.
    const custom = game('custom', ['Rosa', 'Tito'], [], { target: 77, rules: { passPoints: 0 } });
    assert.equal((await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [custom] } })).data.accepted.length, 1);
  });
});

describe('papelera', () => {
  test('una partida en la papelera deja de contar, el dispositivo la retira y al restaurarla la recupera', async () => {
    const g = game('papel', ['Rosa', 'Tito'], [['s0', 100]]);
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [g] } });
    const rosaWins = async () => (await api('/admin/ranking', { token: tokens.owner })).data.ranking.find((p) => p.name === 'Rosa')?.wins ?? 0;
    const before = await rosaWins();
    assert.equal((await api('/admin/games/papel', { method: 'DELETE', token: tokens.owner, body: { reason: 'Duplicada' } })).status, 204);
    assert.equal(await rosaWins(), before - 1, 'sale de las estadísticas');
    const sync = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [], known: [{ id: 'papel', adminRevision: 0 }], pull: true } });
    assert.deepEqual(sync.data.deleted, ['papel']);
    const listed = (await api('/admin/trash', { token: tokens.owner })).data.games.find((x) => x.game.id === 'papel');
    assert.equal(listed.dependencies.hands, 1);
    assert.equal((await api('/admin/trash/games/papel/restore', { method: 'POST', token: tokens.owner, body: { reason: 'Era válida' } })).status, 200);
    assert.equal(await rosaWins(), before, 'vuelve a contar, sin duplicarse');
    const pulled = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [], known: [], pull: true } });
    assert.ok(pulled.data.serverVersions.some((x) => x.id === 'papel'), 'el dueño la recupera');
    const other = await api('/sync/games', { method: 'POST', token: tokens.mesa2, body: { games: [], known: [], pull: true } });
    assert.ok(!other.data.serverVersions.some((x) => x.id === 'papel'), 'otra cuenta no la recibe');
  });

  test('restaurar con conflicto se explica y no restaura nada', async () => {
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('conf', ['Rosa', 'Lola'], [['s0', 5]])] } });
    const lola = (await api('/admin/players?search=Lola', { token: tokens.owner })).data.players[0];
    await api('/admin/games/conf', { method: 'DELETE', token: tokens.owner, body: { reason: 'Prueba' } });
    await api(`/admin/players/${lola.id}`, { method: 'DELETE', token: tokens.owner, body: { reason: 'Prueba' } });
    const r = await api('/admin/trash/games/conf/restore', { method: 'POST', token: tokens.owner, body: { reason: 'Prueba' } });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Lola/);
    assert.ok((await api('/admin/games/conf', { token: tokens.owner })).data.game.deletedAt, 'sigue en la papelera');
  });

  test('eliminar definitivamente exige confirmación explícita y conserva la auditoría', async () => {
    const noWord = await api('/admin/trash/games/conf', { method: 'DELETE', token: tokens.owner, body: { reason: 'Limpieza' } });
    assert.equal(noWord.status, 400);
    const ok = await api('/admin/trash/games/conf', { method: 'DELETE', token: tokens.owner, body: { reason: 'Limpieza', confirm: 'ELIMINAR' } });
    assert.equal(ok.status, 204);
    assert.equal((await api('/admin/games/conf', { token: tokens.owner })).status, 404);
    const resend = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('conf', ['Rosa', 'Lola'], [['s0', 5], ['s1', 1]])] } });
    assert.deepEqual(resend.data.deleted, ['conf'], 'no vuelve por sincronización');
    const audit = (await api('/admin/audit?search=conf', { token: tokens.owner })).data.corrections;
    assert.ok(audit.some((a) => a.action === 'eliminar_definitivo'));
  });
});

describe('duplicados', () => {
  test('la fusión se bloquea si produciría participantes duplicados', async () => {
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('dup1', ['José', 'Rosa'], [['s0', 100]]), game('dup2', ['jose', 'Tito'], [['s1', 100]])] } });
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('choque', ['José ', 'Ana'], [])] } });
    const groups = (await api('/admin/players/duplicates', { token: tokens.owner })).data.groups;
    const g = groups.find((x) => x.some((p) => p.name === 'José'));
    assert.ok(g, 'detecta José / jose');
    // Partida con ambos perfiles (José y Pepe) para provocar el conflicto.
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('ambos', ['José', 'Pepe'], [])] } });
    const pepe = (await api('/admin/players?search=Pepe', { token: tokens.owner })).data.players[0];
    const jose = g.find((p) => p.name === 'José');
    const preview = await api('/admin/players/merge/preview', { method: 'POST', token: tokens.owner, body: { primaryId: jose.id, duplicateIds: [pepe.id] } });
    assert.equal(preview.data.canMerge, false);
    const merge = await api('/admin/players/merge', { method: 'POST', token: tokens.owner, body: { primaryId: jose.id, duplicateIds: [pepe.id], reason: 'Intento' } });
    assert.equal(merge.status, 409);
    assert.ok((await api(`/admin/players/${pepe.id}`, { token: tokens.owner })).data.player, 'nada cambió');
  });

  test('fusión atómica: une historial y estadísticas sin duplicar resultados', async () => {
    const groups = (await api('/admin/players/duplicates', { token: tokens.owner })).data.groups;
    const g = groups.find((x) => x.some((p) => p.name === 'José'));
    const jose = g.find((p) => p.name === 'José');
    const dup = g.find((p) => p.name === 'jose');
    const preview = await api('/admin/players/merge/preview', { method: 'POST', token: tokens.owner, body: { primaryId: jose.id, duplicateIds: [dup.id] } });
    assert.equal(preview.data.canMerge, true);
    assert.equal(preview.data.games, 1);
    const merged = await api('/admin/players/merge', { method: 'POST', token: tokens.owner, body: { primaryId: jose.id, duplicateIds: [dup.id], reason: 'Mismo jugador' } });
    assert.equal(merged.status, 200);
    const detail = (await api(`/admin/players/${jose.id}`, { token: tokens.owner })).data;
    assert.equal(detail.player.wins, 1);
    assert.equal(detail.player.losses, 1);
    assert.ok(detail.aliases.includes('jose'));
    const dup2 = (await api('/admin/games/dup2', { token: tokens.owner })).data.game;
    assert.equal(dup2.participants[0].name, 'José');
    assert.equal(dup2.participants[0].playerId, 'c-jose', 'mismo identificador para la app');
    // Una partida antigua que llega con el nombre anterior no recrea el perfil duplicado.
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('tardia', ['jose', 'Tito'], [])] } });
    const again = (await api('/admin/players?search=Jos', { token: tokens.owner })).data.players;
    assert.deepEqual(again.map((p) => p.name), ['José']);
    // El dispositivo recibe la versión corregida de la partida que ya tenía.
    const s = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [], known: [{ id: 'dup2', adminRevision: 0 }] } });
    assert.equal(s.data.serverVersions[0].participants[0].name, 'José');
  });
});

describe('torneos desde el panel', () => {
  let id;
  test('crear, pausar, reanudar y gestionar participantes', async () => {
    const owners = (await api('/admin/users', { token: tokens.owner })).data.users;
    const mesa = owners.find((u) => u.username === 'mesa');
    const r = await api('/admin/tournaments', {
      method: 'POST',
      token: tokens.owner,
      body: { name: 'Copa Panel', mode: 'individual', target: 100, entrants: ['A1', 'A2', 'A3'].map((n) => ({ players: [n] })), ownerUserId: mesa.id },
    });
    assert.equal(r.status, 201);
    id = r.data.tournament.id;
    assert.equal(r.data.tournament.bracket[0].filter((m) => m.isBye).length, 1, 'un pase automático');
    const pull = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [], pull: true } });
    assert.ok(pull.data.serverTournaments.some((t) => t.id === id), 'el organizador recibe el torneo');
    assert.equal((await api(`/admin/tournaments/${id}`, { method: 'PATCH', token: tokens.owner, body: { action: 'pausar', reason: 'Lluvia' } })).data.tournament.status, 'pausado');
    assert.equal((await api(`/admin/tournaments/${id}`, { method: 'PATCH', token: tokens.owner, body: { action: 'pausar', reason: 'x' } })).status, 400);
    assert.equal((await api(`/admin/tournaments/${id}`, { method: 'PATCH', token: tokens.owner, body: { action: 'reanudar', reason: 'Seguimos' } })).data.tournament.status, 'activo');
    const tour = (await api(`/admin/tournaments/${id}`, { token: tokens.owner })).data.tournament;
    const a3 = tour.entrants.find((e) => e.name === 'A3');
    const swap = await api(`/admin/tournaments/${id}/entrants/${a3.id}`, { method: 'PATCH', token: tokens.owner, body: { players: ['A4'], reason: 'Reemplazo' } });
    assert.equal(swap.status, 200);
    assert.ok(swap.data.tournament.entrants.some((e) => e.name === 'A4'));
    const redraw = await api(`/admin/tournaments/${id}/entrants`, { method: 'PUT', token: tokens.owner, body: { entrants: ['A1', 'A2', 'A4', 'A5'].map((n) => ({ players: [n] })), reason: 'Se sumó A5' } });
    assert.equal(redraw.status, 200);
    assert.equal(redraw.data.tournament.bracket[0].filter((m) => m.isBye).length, 0);
  });

  test('no se pueden cambiar participantes que ya jugaron ni resortear con partidas iniciadas', async () => {
    const tour = (await api(`/admin/tournaments/${id}`, { token: tokens.owner })).data.tournament;
    const m = tour.bracket[0][0];
    const g = game('tp1', [m.a.players[0].name, m.b.players[0].name], [['s0', 100]], { tournamentId: id, matchId: m.id });
    g.sides = g.sides.map((s, i) => ({ ...s, entrantId: i === 0 ? m.a.id : m.b.id }));
    const s = await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [g] } });
    assert.equal(s.data.accepted.length, 1);
    const swap = await api(`/admin/tournaments/${id}/entrants/${m.a.id}`, { method: 'PATCH', token: tokens.owner, body: { players: ['Otro'], reason: 'Cambio' } });
    assert.equal(swap.status, 409);
    const redraw = await api(`/admin/tournaments/${id}/entrants`, { method: 'PUT', token: tokens.owner, body: { entrants: ['B1', 'B2'].map((n) => ({ players: [n] })), reason: 'Resorteo' } });
    assert.equal(redraw.status, 409);
    const otherAccount = await api('/sync/games', { method: 'POST', token: tokens.mesa2, body: { games: [{ ...g, id: 'tp-intruso' }] } });
    assert.match(otherAccount.data.errors[0].error, /otra cuenta/, 'una partida en el torneo de otro organizador se rechaza');
    const view = (await api(`/admin/tournaments/${id}`, { token: tokens.owner })).data.tournament;
    assert.equal(view.bracket[0][0].state, 'terminado');
    const cancel = await api(`/admin/tournaments/${id}`, { method: 'PATCH', token: tokens.owner, body: { action: 'cancelar', reason: 'Fin' } });
    assert.equal(cancel.data.tournament.status, 'cancelado');
  });
});

describe('pruebas, auditoría, exportación y apariencia', () => {
  test('las partidas de prueba se marcan, no cuentan y se limpian sin tocar las reales', async () => {
    await api('/sync/games', { method: 'POST', token: tokens.mesa, body: { games: [game('test1', ['Zoe', 'Rosa'], [['s0', 100]])] } });
    const zoeWins = async () => (await api('/admin/ranking', { token: tokens.owner })).data.ranking.find((p) => p.name === 'Zoe')?.wins ?? 0;
    assert.equal(await zoeWins(), 1);
    const mark = await api('/admin/games/test1', { method: 'PATCH', token: tokens.owner, body: { practice: true, reason: 'Era una prueba' } });
    assert.equal(mark.data.game.practice, true);
    assert.equal(await zoeWins(), 0);
    const realBefore = (await api('/admin/games?type=reales&size=100', { token: tokens.owner })).data.total;
    const noConfirm = await api('/admin/tests/cleanup', { method: 'POST', token: tokens.owner, body: { reason: 'Limpieza' } });
    assert.equal(noConfirm.status, 400);
    const clean = await api('/admin/tests/cleanup', { method: 'POST', token: tokens.owner, body: { reason: 'Limpieza', confirm: true } });
    assert.ok(clean.data.moved >= 1);
    assert.equal((await api('/admin/tests', { token: tokens.owner })).data.total, 0);
    assert.equal((await api('/admin/games?type=reales&size=100', { token: tokens.owner })).data.total, realBefore);
  });

  test('la auditoría registra autor, motivo y valores, sin contraseñas, y no se puede alterar', async () => {
    const users = (await api('/admin/users', { token: tokens.owner })).data.users;
    const mesa = users.find((u) => u.username === 'mesa');
    await api(`/admin/users/${mesa.id}`, { method: 'PATCH', token: tokens.owner, body: { password: 'nueva-clave-segura', reason: 'Olvido' } });
    const log = (await api('/admin/audit?entity=usuario', { token: tokens.owner })).data;
    const entry = log.corrections.find((c) => c.entityId === String(mesa.id) && c.after?.passwordChanged);
    assert.equal(entry.adminUsername, 'duena');
    assert.equal(entry.reason, 'Olvido');
    const all = JSON.stringify((await api('/admin/audit?size=100', { token: tokens.owner })).data);
    assert.ok(!all.includes('nueva-clave-segura') && !all.includes('scrypt$'), 'sin secretos');
    await assert.rejects(db.run("UPDATE domino.corrections SET reason = 'x'"), /no se puede modificar/);
    await assert.rejects(db.run('DELETE FROM domino.corrections'), /no se puede modificar/);
    const paged = (await api('/admin/audit?size=2&page=2', { token: tokens.owner })).data;
    assert.equal(paged.corrections.length, 2);
    assert.ok(paged.total > 4);
  });

  test('exportación CSV con filtros, sin datos privados y a salvo de fórmulas', async () => {
    await api('/sync/games', { method: 'POST', token: tokens.mesa2, body: { games: [game('formula', ['=CMD()', 'Rosa'], [['s1', 100]])] } });
    const r = await api('/admin/export/resultados?player=CMD', { token: tokens.owner, raw: true });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /domino-resultados-/);
    assert.ok(r.data.includes("'=CMD()"), 'la fórmula queda neutralizada');
    const players = await api('/admin/export/jugadores', { token: tokens.owner, raw: true });
    assert.ok(!players.data.includes('@example.com'));
    const stats = await api('/admin/export/estadisticas', { token: tokens.owner, raw: true });
    assert.match(stats.data, /Jugador,Partidas,Ganadas/);
    assert.equal((await api('/admin/export/usuarios', { token: tokens.owner })).status, 404);
  });

  test('identidad visual: valida formato y tamaño del logo y se puede restaurar', async () => {
    const fake = await api('/admin/branding', { method: 'PUT', token: tokens.owner, body: { appName: 'Club', logo: `data:image/png;base64,${Buffer.from('no soy png').toString('base64')}` } });
    assert.equal(fake.status, 400);
    // Cualquier tamaño de imagen se acepta (la app la comprime antes de subirla), incluso muy pequeña.
    const tiny = await api('/admin/branding', { method: 'PUT', token: tokens.owner, body: { appName: 'Club', logo: png(8, 8) } });
    assert.equal(tiny.status, 200);
    // Solo se rechaza un archivo desproporcionado (más de 1 MB), que la app nunca envía.
    const huge = `data:image/png;base64,${Buffer.concat([Buffer.from(png(64, 64).split(',')[1], 'base64'), randomBytes(1100 * 1024)]).toString('base64')}`;
    const big = await api('/admin/branding', { method: 'PUT', token: tokens.owner, body: { appName: 'Club', logo: huge } });
    assert.match(big.data.error, /máximo es 1024 KB/);
    const ok = await api('/admin/branding', { method: 'PUT', token: tokens.owner, body: { appName: 'Club Dominó', tagline: 'Liga del barrio', logo: png(64, 64) } });
    assert.equal(ok.status, 200);
    assert.equal((await api('/public/config')).data.branding.appName, 'Club Dominó');
    const audit = (await api('/admin/audit?search=identidad', { token: tokens.owner })).data.corrections[0];
    assert.ok(!JSON.stringify(audit).includes('base64'), 'la auditoría no guarda la imagen');
    await api('/admin/branding', { method: 'DELETE', token: tokens.owner, body: { reason: 'Volver al original' } });
    assert.equal((await api('/public/config')).data.branding.appName, 'Dominó');
  });

  test('apariencia: rechaza colores ilegibles y persiste el tema global', async () => {
    const unreadable = await api('/admin/appearance', {
      method: 'PUT',
      token: tokens.owner,
      body: { preset: 'x', colors: { primary: '#C6F432', secondary: '#A06BFF', background: '#FFFFFF', card: '#FFFFFF', text: '#EEEEEE', button: '#C6F432' } },
    });
    assert.equal(unreadable.status, 400);
    assert.match(unreadable.data.error, /contraste/);
    const red = { primary: '#FF5A4E', secondary: '#FFC145', background: '#1A0608', card: '#2E0D11', text: '#FFFFFF', button: '#FF5A4E' };
    assert.deepEqual(contrastProblems(red), []);
    const ok = await api('/admin/appearance', { method: 'PUT', token: tokens.admin, body: { preset: 'rojo', colors: red } });
    assert.equal(ok.status, 200);
    assert.equal((await api('/public/config')).data.appearance.preset, 'rojo');
    assert.equal((await api('/admin/appearance', { method: 'PUT', token: tokens.mesa2, body: { preset: 'rojo', colors: red } })).status, 403);
    await api('/admin/appearance', { method: 'DELETE', token: tokens.owner, body: { reason: 'Tema original' } });
    assert.equal((await api('/public/config')).data.appearance.preset, 'original');
  });
});

describe('foto de perfil de la cuenta', () => {
  test('cada usuario pone, cambia y quita su propia foto; se valida el formato', async () => {
    const token = (await api('/auth/login', { method: 'POST', body: { username: 'mesa2', password: PASS.mesa2 } })).data.token;
    assert.equal((await api('/auth/me/photo', { method: 'PUT', body: { photo: png(64, 64) } })).status, 401, 'exige sesión');
    const bad = await api('/auth/me/photo', { method: 'PUT', token, body: { photo: 'data:image/png;base64,AAAA' } });
    assert.equal(bad.status, 400);
    const set = await api('/auth/me/photo', { method: 'PUT', token, body: { photo: png(64, 64) } });
    assert.equal(set.status, 200);
    assert.match(set.data.user.photo, /^data:image\/png;base64,/);
    assert.equal((await api('/auth/me', { token })).data.user.photo, set.data.user.photo, 'se conserva al volver a entrar');
    const removed = await api('/auth/me/photo', { method: 'PUT', token, body: { photo: null } });
    assert.equal(removed.data.user.photo, null);
  });
});
