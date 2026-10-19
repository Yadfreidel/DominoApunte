/// <reference types="node" />
// Victoria (resumen para la celebración), siguiente partida sin duplicados y pantalla encendida.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addHand, createGame, createRematch, filterGames, findRematch, isCountable, victorySummary, type Game } from '../src/domain/game.ts';
import { createWebWakeLock, type WakeLockEnv } from '../src/services/wakeLock.ts';

const T = '2026-10-19T20:00:00.000Z';
let n = 0;
const ids = () => `v${++n}`;

const individual = (target = 200) => createGame({ playerCount: 2, names: ['Juan', 'Rosa'], mode: 'individual', target }, T, ids);
const parejas = (teamNames?: [string, string]) =>
  createGame({ playerCount: 4, names: ['Juan', 'Pedro', 'Ana', 'Luis'], mode: 'parejas', target: 200, teamNames }, T, ids);
const play = (game: Game, ...hands: [number, number][]) => hands.reduce((g, [side, pts]) => addHand(g, g.sides[side].id, pts, ids(), T), game);

describe('resumen de la victoria', () => {
  test('pareja que supera la meta: nombres, puntos finales y diferencia', () => {
    const g = play(parejas(), [0, 120], [1, 90], [0, 95]);
    const v = victorySummary(g)!;
    assert.equal(v.headline, '¡Juan y Pedro ganaron!');
    assert.equal(v.detail, '215 puntos · ¡Se pasaron por 15 puntos!');
    assert.equal(v.points, 215);
    assert.equal(v.over, 15);
    assert.equal(v.exact, false);
    assert.deepEqual(v.scores.map((s) => [s.name, s.points, s.winner]), [['Juan y Pedro', 215, true], ['Ana y Luis', 90, false]]);
  });

  test('meta exacta', () => {
    const v = victorySummary(play(individual(), [0, 150], [0, 50]))!;
    assert.equal(v.headline, '¡Juan ganó!');
    assert.equal(v.detail, '¡Meta exacta: 200 puntos!');
    assert.equal(v.exact, true);
    assert.equal(v.over, 0);
  });

  test('individual por encima de la meta y por un solo punto', () => {
    const v = victorySummary(play(individual(), [1, 201]))!;
    assert.equal(v.headline, '¡Rosa ganó!');
    assert.equal(v.detail, '201 puntos · ¡Se pasó por 1 punto!');
  });

  test('pareja con nombre propio muestra el equipo y sus integrantes', () => {
    const v = victorySummary(play(parejas(['Los Tigres', 'Las Águilas']), [1, 230]))!;
    assert.equal(v.headline, '¡Las Águilas ganaron!');
    assert.equal(v.members, 'Ana y Luis');
  });

  test('no hay celebración para partidas sin terminar', () => {
    assert.equal(victorySummary(play(individual(), [0, 199])), null);
  });
});

describe('siguiente partida y estadísticas', () => {
  test('la revancha conserva participantes y configuración, empieza en cero y no altera la terminada', () => {
    const finished = play(createGame({ playerCount: 4, names: ['Juan', 'Pedro', 'Ana', 'Luis'], mode: 'parejas', target: 150, rules: { passPoints: 20 } }, T, ids), [0, 150]);
    const next = createRematch(finished, T, ids);
    assert.equal(next.status, 'pendiente');
    assert.equal(next.hands.length, 0);
    assert.equal(next.target, 150);
    assert.equal(next.mode, 'parejas');
    assert.deepEqual(next.rules, { passPoints: 20 });
    assert.deepEqual(next.participants.map((p) => p.name), finished.participants.map((p) => p.name));
    assert.equal(finished.status, 'terminada', 'la partida terminada queda intacta en el historial');
    assert.ok(isCountable(finished));
  });

  test('una partida terminada tiene una sola revancha: se encuentra y se reutiliza', () => {
    const finished = play(individual(), [0, 200]);
    const games = [finished];
    assert.equal(findRematch(games, finished.id), undefined);
    const next = createRematch(finished, T, ids);
    games.push(next);
    assert.equal(findRematch(games, finished.id)?.id, next.id);
    // Solo la partida terminada cuenta para las estadísticas; la nueva todavía no.
    assert.equal(filterGames(games, { status: 'terminada' }).length, 1);
    assert.equal(games.filter(isCountable).length, 1);
  });
});

describe('pantalla encendida (Screen Wake Lock)', () => {
  function fakeEnv({ supported = true, reject = false } = {}) {
    const listeners = new Set<() => void>();
    const state = { requests: 0, releases: 0 };
    const doc = {
      visibilityState: 'visible',
      addEventListener: (_: 'visibilitychange', fn: () => void) => listeners.add(fn),
      removeEventListener: (_: 'visibilitychange', fn: () => void) => listeners.delete(fn),
    };
    const env: WakeLockEnv = {
      document: doc,
      wakeLock: supported
        ? {
            request: async () => {
              state.requests++;
              if (reject) throw new Error('NotAllowedError');
              const sentinel = {
                released: false,
                release: async () => {
                  sentinel.released = true;
                  state.releases++;
                },
              };
              return sentinel;
            },
          }
        : undefined,
    };
    const setVisible = async (visible: boolean) => {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      listeners.forEach((fn) => fn());
      await new Promise((r) => setTimeout(r, 0));
    };
    return { env, state, setVisible, listeners };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('pide el bloqueo, lo libera al quedar oculta y lo vuelve a pedir al regresar', async () => {
    const { env, state, setVisible } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    await tick();
    assert.equal(lock.isHeld(), true);
    await setVisible(false);
    assert.equal(lock.isHeld(), false);
    assert.equal(state.releases, 1);
    await setVisible(true);
    assert.equal(lock.isHeld(), true);
    assert.equal(state.requests, 2);
  });

  test('al detenerlo libera el bloqueo y deja de escuchar', async () => {
    const { env, listeners } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    lock.start(); // no duplica
    await tick();
    assert.equal(listeners.size, 1);
    lock.stop();
    assert.equal(lock.isHeld(), false);
    assert.equal(listeners.size, 0);
  });

  test('sin soporte o si el navegador lo rechaza, no falla', async () => {
    const unsupported = createWebWakeLock(fakeEnv({ supported: false }).env);
    assert.equal(unsupported.supported, false);
    unsupported.start();
    await tick();
    assert.equal(unsupported.isHeld(), false);
    const rejected = createWebWakeLock(fakeEnv({ reject: true }).env);
    rejected.start();
    await tick();
    assert.equal(rejected.isHeld(), false);
    rejected.stop();
  });
});
