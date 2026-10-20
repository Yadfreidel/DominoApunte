// Sincronización sin conexión: reenvíos idempotentes, respuesta perdida, correcciones, conflictos entre
// dispositivos, separación por cuenta y retos (asociación validada, una sola vez por partida).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

let server;
let base;
let db;
const clockIso = '2026-10-24T18:00:00.000Z';
const tk = {};
const PASS = 'clave-segura-123';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const sync = (token, body) => api('/sync/games', { method: 'POST', token, body: { games: [], ...body } });

/** Partida individual Ana vs Beto con las manos dadas ([lado, puntos]). */
function game(id, hands, { revision = hands.length, baseRevision, deviceId = 'disp-a', at = '2026-10-24T17:00:00.000Z', target = 100, challengeId, entrants } = {}) {
  return {
    id,
    createdAt: at,
    updatedAt: at,
    finishedAt: null,
    status: 'pendiente',
    mode: 'individual',
    target,
    participants: [
      { id: 'pa', name: 'Ana' },
      { id: 'pb', name: 'Beto' },
    ],
    sides: [
      { id: 'sa', name: 'Ana', participantIds: ['pa'], ...(entrants ? { entrantId: entrants[0] } : {}) },
      { id: 'sb', name: 'Beto', participantIds: ['pb'], ...(entrants ? { entrantId: entrants[1] } : {}) },
    ],
    hands: hands.map(([side, points], i) => ({ id: `${id}-h${i}`, sideId: side === 0 ? 'sa' : 'sb', points, createdAt: at })),
    winnerSideId: null,
    rematchOf: null,
    revision,
    ...(baseRevision !== undefined ? { baseRevision } : {}),
    deviceId,
    ...(challengeId ? { challengeId } : {}),
  };
}
const totalsOf = async (id) => (await db.all('SELECT side_id, SUM(points)::int AS pts, COUNT(*)::int AS n FROM domino.hands WHERE game_id = $1 GROUP BY side_id ORDER BY side_id', [id]));

before(async () => {
  db = await openDatabase({ dataDir: 'memory' });
  for (const u of ['ana', 'beto']) {
    await db.run('INSERT INTO domino.users (username, password_hash, role, active, created_at) VALUES ($1, $2, $3, 1, $4)', [u, hashPassword(PASS), 'anotador', clockIso]);
  }
  const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex'), clock: () => clockIso });
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const u of ['ana', 'beto']) tk[u] = (await api('/auth/login', { method: 'POST', body: { username: u, password: PASS } })).data.token;
});
after(() => server?.close());

describe('sincronización idempotente', () => {
  test('reenviar varias veces la misma operación no duplica puntos ni manos', async () => {
    const g = game('idem1', [[0, 30], [1, 20]], { baseRevision: null });
    for (let i = 0; i < 4; i++) {
      const r = await sync(tk.ana, { games: [g] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.accepted, [{ id: 'idem1', revision: 2 }]);
      assert.deepEqual(r.data.conflicts, []);
    }
    assert.deepEqual(await totalsOf('idem1'), [
      { side_id: 'sa', pts: 30, n: 1 },
      { side_id: 'sb', pts: 20, n: 1 },
    ]);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM domino.games WHERE id = 'idem1'")).n, 1);
  });

  test('respuesta perdida: el servidor guardó, el dispositivo reenvía y luego sigue sin conflicto', async () => {
    // Revisión 1 confirmada.
    await sync(tk.ana, { games: [game('lost', [[0, 10]], { baseRevision: null })] });
    // Revisión 2 (base 1): el servidor la guarda pero la respuesta no llega.
    const rev2 = game('lost', [[0, 10], [1, 15]], { baseRevision: 1 });
    await sync(tk.ana, { games: [rev2] });
    // Reintento idéntico (sigue con base 1 porque el dispositivo no vio la confirmación).
    const retry = await sync(tk.ana, { games: [rev2] });
    assert.deepEqual(retry.data.accepted, [{ id: 'lost', revision: 2 }]);
    assert.deepEqual(retry.data.conflicts, []);
    // Antes de recibir la confirmación anotó otra mano (revisión 3, base todavía 1): mismo dispositivo, se acepta.
    const rev3 = game('lost', [[0, 10], [1, 15], [0, 5]], { baseRevision: 1 });
    const r3 = await sync(tk.ana, { games: [rev3] });
    assert.deepEqual(r3.data.accepted, [{ id: 'lost', revision: 3 }]);
    assert.deepEqual(await totalsOf('lost'), [
      { side_id: 'sa', pts: 15, n: 2 },
      { side_id: 'sb', pts: 15, n: 1 },
    ]);
  });

  test('una corrección hecha sin conexión se sincroniza (cambia puntos, no suma otra mano)', async () => {
    await sync(tk.ana, { games: [game('fix', [[0, 40], [1, 10]], { baseRevision: null })] });
    const corrected = game('fix', [[0, 25], [1, 10]], { revision: 3, baseRevision: 2 });
    const r = await sync(tk.ana, { games: [corrected] });
    assert.deepEqual(r.data.accepted, [{ id: 'fix', revision: 3 }]);
    assert.deepEqual(await totalsOf('fix'), [
      { side_id: 'sa', pts: 25, n: 1 },
      { side_id: 'sb', pts: 10, n: 1 },
    ]);
    // Anular una mano (deshacer) también viaja como una revisión más.
    const undone = game('fix', [[0, 25]], { revision: 4, baseRevision: 3 });
    await sync(tk.ana, { games: [undone] });
    assert.deepEqual(await totalsOf('fix'), [{ side_id: 'sa', pts: 25, n: 1 }]);
  });

  test('una partida terminada se guarda una sola vez aunque se reenvíe tras terminar', async () => {
    const won = { ...game('won', [[0, 100]], { baseRevision: null }), status: 'terminada', finishedAt: '2026-10-24T17:30:00.000Z' };
    await sync(tk.ana, { games: [won] });
    await sync(tk.ana, { games: [won] });
    const rows = await db.all("SELECT status, winner_side_id FROM domino.games WHERE id = 'won'");
    assert.deepEqual(rows, [{ status: 'terminada', winner_side_id: 'sa' }]);
  });
});

describe('conflictos entre dispositivos', () => {
  test('dos dispositivos cambian la misma partida: el segundo recibe un conflicto y no sobrescribe', async () => {
    await sync(tk.ana, { games: [game('dup', [[0, 10]], { baseRevision: null, deviceId: 'disp-a' })] });
    // Ambos parten de la revisión 1. El dispositivo A sincroniza primero.
    const a = game('dup', [[0, 10], [0, 20]], { baseRevision: 1, deviceId: 'disp-a' });
    assert.deepEqual((await sync(tk.ana, { games: [a] })).data.accepted, [{ id: 'dup', revision: 2 }]);
    // El dispositivo B (misma cuenta) anotó otra cosa sin conexión, también como revisión 2 y luego 3.
    for (const b of [game('dup', [[0, 10], [1, 50]], { baseRevision: 1, deviceId: 'disp-b' }), game('dup', [[0, 10], [1, 50], [1, 5]], { baseRevision: 1, deviceId: 'disp-b' })]) {
      const r = await sync(tk.ana, { games: [b] });
      assert.deepEqual(r.data.conflicts, ['dup']);
      assert.deepEqual(r.data.accepted, []);
      assert.equal(r.data.serverVersions[0].id, 'dup');
      assert.equal(r.data.serverVersions[0].hands.length, 2);
    }
    assert.deepEqual(await totalsOf('dup'), [{ side_id: 'sa', pts: 30, n: 2 }], 'la versión del servidor no cambió');
    // B decide conservar la suya: reenvía sobre la versión del servidor (base 2) y se acepta.
    const keep = game('dup', [[0, 10], [1, 50], [1, 5]], { revision: 3, baseRevision: 2, deviceId: 'disp-b' });
    assert.deepEqual((await sync(tk.ana, { games: [keep] })).data.accepted, [{ id: 'dup', revision: 3 }]);
  });

  test('las versiones anteriores de la app (sin revisión base) siguen sincronizando como antes', async () => {
    const legacy = game('old', [[0, 10]]);
    delete legacy.deviceId;
    assert.deepEqual((await sync(tk.ana, { games: [legacy] })).data.accepted, [{ id: 'old', revision: 1 }]);
    assert.deepEqual((await sync(tk.ana, { games: [legacy] })).data.accepted, [{ id: 'old', revision: 1 }]);
  });

  test('otra cuenta no puede subir cambios a una partida ajena', async () => {
    const r = await sync(tk.beto, { games: [game('idem1', [[1, 500]], { revision: 9, baseRevision: 2 })] });
    assert.match(r.data.errors[0].error, /otra cuenta/);
    assert.deepEqual(await totalsOf('idem1'), [
      { side_id: 'sa', pts: 30, n: 1 },
      { side_id: 'sb', pts: 20, n: 1 },
    ]);
  });
});

describe('retos', () => {
  const challenge = (over = {}) => ({
    id: 'reto1',
    name: 'Fin de semana',
    kind: 'serie',
    mode: 'individual',
    status: 'activo',
    entrants: [
      { id: 'ea', name: 'Ana', players: [{ name: 'Ana' }] },
      { id: 'eb', name: 'Beto', players: [{ name: 'Beto' }] },
    ],
    target: 100,
    rules: null,
    winsNeeded: null,
    startsOn: '2026-10-24',
    endsOn: '2026-10-25',
    timeZone: 'America/Santo_Domingo',
    tiePolicy: 'empate',
    createdAt: '2026-10-23T12:00:00.000Z',
    updatedAt: '2026-10-23T12:00:00.000Z',
    revision: 0,
    declared: null,
    log: [{ at: '2026-10-23T12:00:00.000Z', text: 'Reto creado' }],
    ...over,
  });

  test('el reto se sincroniza antes que sus partidas y la partida compatible queda asociada', async () => {
    const g = game('rg1', [[0, 100]], { baseRevision: null, challengeId: 'reto1', entrants: ['ea', 'eb'] });
    const r = await sync(tk.ana, { challenges: [challenge()], games: [{ ...g, status: 'terminada', finishedAt: '2026-10-24T17:30:00.000Z' }] });
    assert.deepEqual(r.data.acceptedChallenges, [{ id: 'reto1', revision: 0 }]);
    assert.deepEqual(r.data.warnings, []);
    assert.equal((await db.get("SELECT challenge_id FROM domino.games WHERE id = 'rg1'")).challenge_id, 'reto1');
    // Reenviar el reto es idempotente.
    assert.deepEqual((await sync(tk.ana, { challenges: [challenge()] })).data.acceptedChallenges, [{ id: 'reto1', revision: 0 }]);
  });

  test('una partida incompatible (otra meta) se guarda pero sin reto, con aviso', async () => {
    const g = game('rg2', [[0, 10]], { baseRevision: null, challengeId: 'reto1', entrants: ['ea', 'eb'], target: 150 });
    const r = await sync(tk.ana, { games: [g] });
    assert.equal(r.data.accepted[0].id, 'rg2');
    assert.match(r.data.warnings[0].warning, /no cuenta para el reto: la meta no coincide/);
    assert.equal(r.data.warnings[0].challengeId, null);
    assert.equal((await db.get("SELECT challenge_id FROM domino.games WHERE id = 'rg2'")).challenge_id, null);
  });

  test('una partida empezada fuera del período no entra en la serie', async () => {
    const g = game('rg3', [[0, 10]], { baseRevision: null, challengeId: 'reto1', entrants: ['ea', 'eb'], at: '2026-10-26T15:00:00.000Z' });
    const r = await sync(tk.ana, { games: [g] });
    assert.match(r.data.warnings[0].warning, /fuera del período/);
  });

  test('otra cuenta no puede usar ni modificar el reto', async () => {
    const g = game('rg4', [[0, 10]], { baseRevision: null, challengeId: 'reto1', entrants: ['ea', 'eb'] });
    const r = await sync(tk.beto, { games: [g], challenges: [challenge({ name: 'Robado', revision: 5 })] });
    assert.match(r.data.errors[0].error, /reto de otra cuenta/);
    assert.match(r.data.warnings[0].warning, /el reto es de otra cuenta/);
    assert.equal((await db.get("SELECT name FROM domino.challenges WHERE id = 'reto1'")).name, 'Fin de semana');
  });

  test('la asociación con el reto no cambia después de crear la partida', async () => {
    const moved = game('rg1', [[0, 100], [1, 5]], { revision: 2, baseRevision: 1, challengeId: 'otro', entrants: ['ea', 'eb'] });
    await sync(tk.ana, { games: [moved] });
    assert.equal((await db.get("SELECT challenge_id FROM domino.games WHERE id = 'rg1'")).challenge_id, 'reto1');
  });

  test('un reto inválido se rechaza con un error claro', async () => {
    const r = await sync(tk.ana, { challenges: [challenge({ id: 'reto2', endsOn: '2026-10-01' })] });
    assert.match(r.data.errors[0].error, /Fechas de la serie inválidas/);
  });
});
