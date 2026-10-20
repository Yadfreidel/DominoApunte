/// <reference types="node" />
// Cola de sincronización: reintentos progresivos, separación por cuenta, revisión base y estado visible.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addHand, createGame, type Game } from '../src/domain/game.ts';
import { backoffDelay, outgoingGame, selectPending, syncKind, SYNC_BACKOFF_MAX_MS } from '../src/domain/syncQueue.ts';

let n = 0;
const ids = () => `s${++n}`;
const T = '2026-10-20T20:00:00.000Z';
const g = (accountId: number | null = null): Game => ({
  ...createGame({ playerCount: 2, names: ['Ana', 'Beto'], mode: 'individual', target: 100 }, T, ids),
  accountId,
});

describe('cola de sincronización', () => {
  test('espera progresiva 2 s, 4 s, 8 s… con tope de 5 minutos', () => {
    const fixed = () => 0.5; // sin variación
    assert.deepEqual([0, 1, 2, 3].map((a) => backoffDelay(a, fixed)), [2000, 4000, 8000, 16000]);
    assert.equal(backoffDelay(30, fixed), SYNC_BACKOFF_MAX_MS);
    const jittered = backoffDelay(2, () => 0);
    assert.ok(jittered >= 6400 && jittered <= 9600);
  });

  test('pendiente = revisión no confirmada; lo confirmado no se reenvía', () => {
    const game = g();
    const played = addHand(game, game.sides[0].id, 10, ids(), T);
    assert.deepEqual(selectPending([played], { [played.id]: played.revision }, 1).send, []);
    assert.equal(selectPending([played], { [played.id]: played.revision - 1 }, 1).send.length, 1);
    assert.equal(selectPending([played], {}, 1).send.length, 1);
  });

  test('cada cuenta sube solo lo suyo; lo creado sin sesión lo adopta quien sincroniza', () => {
    const mine = g(1);
    const other = g(2);
    const anonymous = g(null);
    const sel = selectPending([mine, other, anonymous], {}, 1);
    assert.deepEqual(sel.send.map((x) => x.id), [mine.id, anonymous.id]);
    assert.deepEqual(sel.otherAccount.map((x) => x.id), [other.id]);
  });

  test('una partida en conflicto no se envía hasta que el usuario decida', () => {
    const conflicted = { ...g(1), conflict: { server: g(1), at: T } };
    assert.deepEqual(selectPending([conflicted], {}, 1).send, []);
  });

  test('lo que se envía incluye la revisión base y el dispositivo, sin datos locales', () => {
    const game = { ...g(7), conflict: null };
    const out = outgoingGame(game, { [game.id]: 3 }, 'disp-1');
    assert.equal(out.baseRevision, 3);
    assert.equal(out.deviceId, 'disp-1');
    assert.equal('accountId' in out, false);
    assert.equal('conflict' in out, false);
    assert.equal(outgoingGame(game, {}, 'disp-1').baseRevision, null);
  });

  test('estado visible', () => {
    const base = { signedIn: true, syncing: false, pending: 0, conflicts: 0, offline: false, lastError: null };
    assert.equal(syncKind({ ...base, signedIn: false }), 'local');
    assert.equal(syncKind({ ...base, pending: 2, offline: true }), 'sin-conexion');
    assert.equal(syncKind({ ...base, pending: 2 }), 'pendiente');
    assert.equal(syncKind({ ...base, pending: 2, syncing: true }), 'sincronizando');
    assert.equal(syncKind({ ...base, lastError: 'x', pending: 1 }), 'error');
    assert.equal(syncKind({ ...base, conflicts: 1 }), 'conflicto');
    assert.equal(syncKind(base), 'sincronizado');
  });
});
