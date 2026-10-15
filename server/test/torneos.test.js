// Migración de la base de datos, sincronización de torneos y bloqueo de correcciones.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createApp, nextMatchId } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

describe('migración de la base de datos', () => {
  test('una base con el esquema anterior se actualiza sin perder datos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'domino-mig-'));
    try {
      const old = new PGlite(dir);
      await old.exec(readFileSync(new URL('./schema-anterior.sql', import.meta.url), 'utf8'));
      await old.exec(`INSERT INTO domino.games (id, created_at, updated_at, status, mode, target, participants_json, sides_json, winner_side_id)
                      VALUES ('vieja', 'x', 'x', 'terminada', 'individual', 100, '[]', '[]', 's1')`);
      await old.close();

      const db = await openDatabase({ dataDir: dir });
      const row = await db.get("SELECT id, practice, tournament_id, starter_participant_id FROM domino.games WHERE id = 'vieja'");
      assert.deepEqual(row, { id: 'vieja', practice: 0, tournament_id: null, starter_participant_id: null });
      const t = await db.get("SELECT to_regclass('domino.tournaments') AS t");
      assert.equal(t.t, 'domino.tournaments');
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nextMatchId recorre el cuadro', () => {
    const rounds = [[{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [{ id: 'e' }, { id: 'f' }], [{ id: 'g' }]];
    assert.equal(nextMatchId(rounds, 'a'), 'e');
    assert.equal(nextMatchId(rounds, 'd'), 'f');
    assert.equal(nextMatchId(rounds, 'f'), 'g');
    assert.equal(nextMatchId(rounds, 'g'), null);
  });
});

describe('sincronización de torneos y bloqueo', () => {
  let server;
  let base;
  let adminToken;
  let scorerToken;
  const T = '2026-10-15T20:00:00.000Z';

  const api = async (path, { method = 'GET', token, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };

  // Torneo de 4 jugadores: semifinales m1 (e1 vs e2) y m2 (e3 vs e4), final m3.
  const tournament = {
    id: 'tour1',
    name: 'Copa',
    mode: 'individual',
    target: 50,
    status: 'activo',
    createdAt: T,
    updatedAt: T,
    revision: 0,
    entrants: [1, 2, 3, 4].map((i) => ({ id: `e${i}`, name: `J${i}`, players: [{ playerId: `p${i}`, name: `J${i}` }] })),
    rounds: [
      [
        { id: 'm1', round: 0, index: 0, slots: ['e1', 'e2'] },
        { id: 'm2', round: 0, index: 1, slots: ['e3', 'e4'] },
      ],
      [{ id: 'm3', round: 1, index: 0 }],
    ],
  };

  const matchGame = (id, matchId, a, b, winnerPts, extra = {}) => ({
    id,
    createdAt: T,
    updatedAt: T,
    finishedAt: null,
    status: 'pendiente',
    mode: 'individual',
    target: 50,
    participants: [
      { id: 'pa', name: `J${a}`, playerId: `p${a}` },
      { id: 'pb', name: `J${b}`, playerId: `p${b}` },
    ],
    sides: [
      { id: 'sa', name: `J${a}`, participantIds: ['pa'], entrantId: `e${a}` },
      { id: 'sb', name: `J${b}`, participantIds: ['pb'], entrantId: `e${b}` },
    ],
    hands: winnerPts ? [{ id: `${id}-h1`, sideId: 'sa', points: winnerPts, createdAt: T }] : [],
    winnerSideId: null,
    rematchOf: null,
    revision: 1,
    tournamentId: 'tour1',
    matchId,
    starterParticipantId: 'pb',
    ...extra,
  });

  before(async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    for (const [u, role] of [
      ['jefa', 'admin'],
      ['mesa', 'anotador'],
    ]) {
      await db.run('INSERT INTO domino.users (username, password_hash, role, active, created_at) VALUES ($1, $2, $3, 1, $4)', [
        u,
        hashPassword('clave-de-prueba-123'),
        role,
        T,
      ]);
    }
    const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex') });
    await new Promise((r) => {
      server = app.listen(0, '127.0.0.1', r);
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
    adminToken = (await api('/auth/login', { method: 'POST', body: { username: 'jefa', password: 'clave-de-prueba-123' } })).data.token;
    scorerToken = (await api('/auth/login', { method: 'POST', body: { username: 'mesa', password: 'clave-de-prueba-123' } })).data.token;
  });
  after(() => server?.close());

  test('sincroniza el torneo y sus partidas conservando identidad de jugadores y quién sale', async () => {
    const r = await api('/sync/games', {
      method: 'POST',
      token: scorerToken,
      body: { tournaments: [tournament], games: [matchGame('g1', 'm1', 1, 2, 50), matchGame('g2', 'm2', 3, 4, 50)] },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.acceptedTournaments, [{ id: 'tour1', revision: 0 }]);
    assert.equal(r.data.accepted.length, 2);
    const g = (await api('/admin/games/g1', { token: adminToken })).data.game;
    assert.equal(g.tournamentId, 'tour1');
    assert.equal(g.matchId, 'm1');
    assert.equal(g.starterParticipantId, 'pb');
    assert.equal(g.participants[0].playerId, 'p1');
    assert.equal(g.sides[0].entrantId, 'e1');
    assert.equal(g.status, 'terminada');
  });

  test('corrección administrativa permitida mientras la final no empezó; bloqueada después', async () => {
    const ok = await api('/admin/games/g1/hands/g1-h1', { method: 'PATCH', token: adminToken, body: { points: 60, reason: 'Ajuste' } });
    assert.equal(ok.status, 200);
    await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [matchGame('g3', 'm3', 1, 3, 0)] } });
    const blocked = await api('/admin/games/g1/hands/g1-h1', { method: 'PATCH', token: adminToken, body: { points: 10, reason: 'Ajuste' } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /siguiente enfrentamiento/);
    const del = await api('/admin/games/g2', { method: 'DELETE', token: adminToken, body: { reason: 'Prueba' } });
    assert.equal(del.status, 409);
  });

  test('rechaza torneos con jugadores repetidos o cuadros incoherentes', async () => {
    const dup = { ...tournament, id: 'tour2', entrants: tournament.entrants.map((e, i) => (i === 1 ? { ...e, players: [{ playerId: 'p1', name: 'J1' }] } : e)) };
    const bad = { ...tournament, id: 'tour3', rounds: [[{ id: 'x', slots: ['e1', 'zz'] }, { id: 'y', slots: ['e3', 'e4'] }], [{ id: 'z' }]] };
    const r = await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [], tournaments: [dup, bad] } });
    assert.equal(r.data.errors.length, 2);
    assert.equal((r.data.acceptedTournaments ?? []).length, 0);
  });

  test('las partidas de práctica no cuentan en el ranking del panel', async () => {
    const practice = { ...matchGame('gp', null, 4, 2, 50), tournamentId: null, matchId: null, practice: true };
    practice.sides = practice.sides.map((s) => ({ ...s, entrantId: undefined }));
    await api('/sync/games', { method: 'POST', token: scorerToken, body: { games: [practice] } });
    const rank = (await api('/admin/ranking', { token: adminToken })).data.ranking;
    const j4 = rank.find((p) => p.name === 'J4');
    assert.equal(j4?.wins ?? 0, 0, 'la victoria de práctica no suma');
    const stored = (await api('/admin/games/gp', { token: adminToken })).data.game;
    assert.equal(stored.practice, true);
  });
});
