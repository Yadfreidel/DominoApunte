import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

let server;
let base;
let db;
let adminToken;
let scorerToken;

const ADMIN_PASS = randomBytes(12).toString('hex');
const SCORER_PASS = randomBytes(12).toString('hex');

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function sampleGame(id, handPoints, overrides = {}) {
  const t = '2026-10-10T20:00:00.000Z';
  return {
    id,
    createdAt: t,
    updatedAt: t,
    finishedAt: null,
    status: 'pendiente',
    mode: 'parejas',
    target: 100,
    participants: [
      { id: 'p1', name: 'Ana' },
      { id: 'p2', name: 'Luis' },
      { id: 'p3', name: 'Marta' },
      { id: 'p4', name: 'Pedro' },
    ],
    sides: [
      { id: 's1', name: 'Nosotros', participantIds: ['p1', 'p2'] },
      { id: 's2', name: 'Ellos', participantIds: ['p3', 'p4'] },
    ],
    hands: handPoints.map(([sideId, points], i) => ({ id: `${id}-h${i}`, sideId, points, createdAt: t })),
    winnerSideId: null,
    rematchOf: null,
    revision: handPoints.length,
    ...overrides,
  };
}

before(async () => {
  db = openDatabase(':memory:');
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)',
  );
  insert.run('admin', hashPassword(ADMIN_PASS), 'admin', new Date().toISOString());
  insert.run('mesa1', hashPassword(SCORER_PASS), 'anotador', new Date().toISOString());
  const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex') });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server?.close());

describe('autenticación y permisos', () => {
  test('rechaza credenciales incorrectas', async () => {
    const r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'incorrecta123' } });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /incorrectos/);
  });

  test('inicia sesión como admin y anotador', async () => {
    const a = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASS } });
    assert.equal(a.status, 200);
    assert.equal(a.data.user.role, 'admin');
    adminToken = a.data.token;
    const s = await api('/auth/login', { method: 'POST', body: { username: 'MESA1', password: SCORER_PASS } });
    assert.equal(s.status, 200);
    assert.equal(s.data.user.role, 'anotador');
    scorerToken = s.data.token;
  });

  test('sin token no hay acceso al panel', async () => {
    assert.equal((await api('/admin/summary')).status, 401);
    assert.equal((await api('/admin/summary', { token: 'basura' })).status, 401);
  });

  test('un anotador no puede usar rutas de administración', async () => {
    const r = await api('/admin/summary', { token: scorerToken });
    assert.equal(r.status, 403);
    const d = await api('/admin/games/x', { method: 'DELETE', token: scorerToken, body: { reason: 'prueba' } });
    assert.equal(d.status, 403);
  });

  test('un token forjado con otro secreto es rechazado', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const forged = jwt.sign({ sub: '1', tv: 0 }, 'otro-secreto-cualquiera-de-32-caracteres!!');
    assert.equal((await api('/admin/summary', { token: forged })).status, 401);
  });

  test('bloquea tras varios intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) {
      await api('/auth/login', { method: 'POST', body: { username: 'fantasma', password: 'xxxxxxxxxxxx' } });
    }
    const r = await api('/auth/login', { method: 'POST', body: { username: 'fantasma', password: 'xxxxxxxxxxxx' } });
    assert.equal(r.status, 429);
  });
});

describe('sincronización y administración', () => {
  test('sincroniza partidas y recalcula el ganador en el servidor', async () => {
    const g1 = sampleGame('g1', [['s1', 60], ['s2', 30], ['s1', 45]]);
    const g2 = sampleGame('g2', [['s2', 20]]);
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [g1, g2] } });
    assert.equal(r.status, 200);
    assert.equal(r.data.accepted.length, 2);
    const detail = await api('/admin/games/g1', { token: adminToken });
    assert.equal(detail.data.game.status, 'terminada');
    assert.equal(detail.data.game.winnerSideId, 's1');
    assert.deepEqual(detail.data.game.totals, { s1: 105, s2: 30 });
  });

  test('acepta parejas con un solo jugador anotado por pareja', async () => {
    const g = sampleGame('g-solo', [['s1', 10]], {
      participants: [
        { id: 'p1', name: 'Ana' },
        { id: 'p3', name: 'Marta' },
      ],
      sides: [
        { id: 's1', name: 'Ana', participantIds: ['p1'] },
        { id: 's2', name: 'Marta', participantIds: ['p3'] },
      ],
    });
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [g] } });
    assert.deepEqual(r.data.accepted.map((a) => a.id), ['g-solo']);
    await api('/admin/games/g-solo', { method: 'DELETE', token: adminToken, body: { reason: 'Limpieza de prueba' } });
  });

  test('rechaza puntos negativos o decimales', async () => {
    const bad = sampleGame('g3', [['s1', -5]]);
    const dec = sampleGame('g4', [['s1', 2.5]]);
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [bad, dec] } });
    assert.equal(r.data.accepted.length, 0);
    assert.equal(r.data.errors.length, 2);
  });

  test('resumen e indicadores', async () => {
    const r = await api('/admin/summary', { token: adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.games, 2);
    assert.equal(r.data.active, 1);
    assert.equal(r.data.finished, 1);
    assert.equal(r.data.players, 4);
  });

  test('corrección de una mano exige motivo, recalcula y queda registrada', async () => {
    const hand = 'g1-h2';
    const noReason = await api(`/admin/games/g1/hands/${hand}`, { method: 'PATCH', token: adminToken, body: { points: 5 } });
    assert.equal(noReason.status, 400);
    const r = await api(`/admin/games/g1/hands/${hand}`, {
      method: 'PATCH',
      token: adminToken,
      body: { points: 5, reason: 'Se anotó 45 en lugar de 5' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.game.status, 'pendiente');
    assert.equal(r.data.game.winnerSideId, null);
    assert.equal(r.data.game.totals.s1, 65);
    const log = await api('/admin/corrections', { token: adminToken });
    const entry = log.data.corrections.find((c) => c.entityId === hand);
    assert.equal(entry.adminUsername, 'admin');
    assert.equal(entry.reason, 'Se anotó 45 en lugar de 5');
    assert.equal(entry.before.points, 45);
    assert.equal(entry.after.points, 5);
    assert.ok(entry.createdAt);
  });

  test('tras una corrección, el dispositivo no puede sobrescribir y recibe la versión del servidor', async () => {
    const stale = sampleGame('g1', [['s1', 60], ['s2', 30], ['s1', 45], ['s2', 10]]);
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [stale] } });
    assert.equal(r.data.accepted.length, 0);
    assert.equal(r.data.serverVersions[0].id, 'g1');
    assert.equal(r.data.serverVersions[0].totals.s1, 65);
  });

  test('tras adoptar la corrección, el dispositivo puede seguir anotando', async () => {
    const first = await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { games: [sampleGame('g1', [['s1', 1]])] },
    });
    const server = first.data.serverVersions[0];
    assert.ok(server.adminRevision > 0);
    const continued = {
      ...server,
      hands: [...server.hands, { id: 'g1-extra', sideId: 's2', points: 25, createdAt: server.updatedAt }],
      revision: server.revision + 1,
    };
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [continued] } });
    assert.deepEqual(r.data.accepted.map((a) => a.id), ['g1']);
    const detail = await api('/admin/games/g1', { token: adminToken });
    assert.equal(detail.data.game.totals.s2, 55);
    assert.equal(detail.data.game.adminRevision, server.adminRevision);
  });

  test('un dispositivo sin cambios recibe las correcciones de partidas que ya tenía', async () => {
    const before = await api('/admin/games/g1', { token: adminToken });
    const fix = await api('/admin/games/g1/hands/g1-extra', {
      method: 'PATCH',
      token: adminToken,
      body: { points: 20, reason: 'Revisión del acta' },
    });
    assert.equal(fix.status, 200);
    const r = await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { games: [], known: [{ id: 'g1', revision: before.data.game.revision, adminRevision: before.data.game.adminRevision }] },
    });
    assert.equal(r.data.serverVersions.length, 1);
    assert.equal(r.data.serverVersions[0].totals.s2, 50);
    const upToDate = await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { games: [], known: [{ id: 'g1', adminRevision: r.data.serverVersions[0].adminRevision }] },
    });
    assert.equal(upToDate.data.serverVersions.length, 0);
  });

  test('ranking por partidas ganadas', async () => {
    await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { games: [sampleGame('g5', [['s2', 120]])] },
    });
    const r = await api('/admin/ranking', { token: adminToken });
    assert.equal(r.status, 200);
    const marta = r.data.ranking.find((p) => p.name === 'Marta');
    assert.equal(marta.position, 1);
    assert.equal(marta.wins, 1);
    assert.equal(marta.losses, 0);
    assert.equal(marta.winRate, 100);
    const ana = r.data.ranking.find((p) => p.name === 'Ana');
    assert.equal(ana.losses, 1);
    assert.equal(ana.winRate, 0);
  });

  test('filtra partidas por jugador, estado y fecha', async () => {
    const byStatus = await api('/admin/games?status=terminada', { token: adminToken });
    assert.deepEqual(byStatus.data.games.map((g) => g.id), ['g5']);
    const byPlayer = await api('/admin/games?player=mar', { token: adminToken });
    assert.equal(byPlayer.data.games.length, 3);
    const byDate = await api('/admin/games?from=2026-10-11', { token: adminToken });
    assert.equal(byDate.data.games.length, 0);
  });

  test('no se puede eliminar un jugador con partidas; sí uno sin partidas', async () => {
    const players = await api('/admin/players', { token: adminToken });
    const ana = players.data.players.find((p) => p.name === 'Ana');
    const del = await api(`/admin/players/${ana.id}`, { method: 'DELETE', token: adminToken, body: { reason: 'Duplicado' } });
    assert.equal(del.status, 409);
    const created = await api('/admin/players', { method: 'POST', token: adminToken, body: { name: 'Temporal' } });
    assert.equal(created.status, 201);
    const ok = await api(`/admin/players/${created.data.player.id}`, {
      method: 'DELETE',
      token: adminToken,
      body: { reason: 'Creado por error' },
    });
    assert.equal(ok.status, 204);
  });

  test('eliminar una partida impide que vuelva por sincronización', async () => {
    const del = await api('/admin/games/g2', { method: 'DELETE', token: adminToken, body: { reason: 'Partida de prueba' } });
    assert.equal(del.status, 204);
    const r = await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { games: [sampleGame('g2', [['s2', 20], ['s1', 5]])] },
    });
    assert.deepEqual(r.data.deleted, ['g2']);
    assert.equal((await api('/admin/games/g2', { token: adminToken })).status, 404);
  });

  test('configuración de metas y modalidades', async () => {
    const bad = await api('/admin/settings', {
      method: 'PUT',
      token: adminToken,
      body: { defaultTargets: [100], defaultTarget: 150, modes: { individual: true, parejas: true } },
    });
    assert.equal(bad.status, 400);
    const ok = await api('/admin/settings', {
      method: 'PUT',
      token: adminToken,
      body: { defaultTargets: [250, 100, 150], defaultTarget: 150, modes: { individual: true, parejas: false } },
    });
    assert.equal(ok.status, 200);
    const pub = await api('/settings', { token: scorerToken });
    assert.deepEqual(pub.data.settings.defaultTargets, [100, 150, 250]);
    assert.equal(pub.data.settings.modes.parejas, false);
  });

  test('desactivar un usuario invalida su sesión al instante', async () => {
    const users = await api('/admin/users', { token: adminToken });
    const mesa = users.data.users.find((u) => u.username === 'mesa1');
    const r = await api(`/admin/users/${mesa.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { active: false, reason: 'Dispositivo extraviado' },
    });
    assert.equal(r.status, 200);
    assert.equal((await api('/auth/me', { token: scorerToken })).status, 401);
  });

  test('un admin no puede quitarse su propio rol', async () => {
    const me = await api('/auth/me', { token: adminToken });
    const r = await api(`/admin/users/${me.data.user.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'anotador', reason: 'prueba' },
    });
    assert.equal(r.status, 400);
  });
});
