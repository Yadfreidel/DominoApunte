/// <reference types="node" />
// Pantalla grande: recuperación del marcador al reconectar, respuestas tardías y victoria.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyFailure,
  applySnapshot,
  connectionStatus,
  initialSpectatorState,
  spectatorVictory,
  STALE_AFTER_MS,
  type SpectatorSnapshot,
} from '../src/domain/spectator.ts';

const snap = (revision: number, a: number, b: number, extra: Partial<SpectatorSnapshot> = {}): SpectatorSnapshot => ({
  revision,
  updatedAt: '2026-10-19T20:00:00Z',
  status: 'pendiente',
  mode: 'parejas',
  target: 200,
  winnerSideId: null,
  sides: [
    { id: 's0', name: 'Juan y Pedro', members: ['Juan', 'Pedro'], total: a },
    { id: 's1', name: 'Luis y Carlos', members: ['Luis', 'Carlos'], total: b },
  ],
  lastHand: revision > 0 ? { sideId: a >= b ? 's0' : 's1', points: 20, at: '2026-10-19T20:00:00Z', number: revision } : null,
  serverTime: '2026-10-19T20:00:00Z',
  ...extra,
});

describe('pantalla grande', () => {
  test('en vivo, sin conexión, desactualizado y recuperación al reconectar', () => {
    let s = initialSpectatorState;
    assert.equal(connectionStatus(s, 0), 'conectando');
    s = applySnapshot(s, snap(1, 20, 0), 1000);
    assert.equal(connectionStatus(s, 2000), 'en_vivo');
    s = applyFailure(s, 'Sin conexión', 3000);
    assert.equal(connectionStatus(s, 3000), 'reconectando');
    assert.equal(s.data?.sides[0].total, 20, 'conserva el último marcador conocido');
    assert.equal(connectionStatus(s, 1000 + STALE_AFTER_MS + 1), 'desactualizado');
    // Al reconectar se toma el estado más reciente del servidor, aunque se hayan perdido varias manos.
    s = applySnapshot(s, snap(4, 80, 40), 20_000);
    assert.equal(connectionStatus(s, 20_500), 'en_vivo');
    assert.equal(s.failures, 0);
    assert.deepEqual(s.data?.sides.map((x) => x.total), [80, 40]);
  });

  test('una respuesta tardía no retrocede el marcador', () => {
    let s = applySnapshot(initialSpectatorState, snap(5, 100, 60), 1000);
    s = applySnapshot(s, snap(3, 60, 40), 2000);
    assert.deepEqual(s.data?.sides.map((x) => x.total), [100, 60]);
  });

  test('detecta la mano nueva para animarla (no en la primera carga)', () => {
    let s = applySnapshot(initialSpectatorState, snap(2, 40, 0), 1000);
    assert.equal(s.scored, null);
    s = applySnapshot(s, snap(3, 60, 0), 2000);
    assert.deepEqual(s.scored, { sideId: 's0', points: 20, number: 3 });
  });

  test('enlace revocado: deja de reintentar', () => {
    const s = applyFailure(applySnapshot(initialSpectatorState, snap(1, 20, 0), 0), 'Enlace desactivado', 1000, true);
    assert.equal(connectionStatus(s, 1000), 'no_disponible');
  });

  test('victoria en la pantalla grande', () => {
    assert.deepEqual(spectatorVictory(snap(9, 215, 90, { status: 'terminada', winnerSideId: 's0' })), {
      headline: '¡Juan y Pedro ganaron!',
      detail: '215 puntos · ¡Se pasaron por 15 puntos!',
    });
    assert.equal(spectatorVictory(snap(9, 200, 90, { status: 'terminada', winnerSideId: 's0' }))?.detail, '¡Meta exacta: 200 puntos!');
    assert.equal(spectatorVictory(snap(3, 50, 20)), null);
  });
});
