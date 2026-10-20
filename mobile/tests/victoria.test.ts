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
  type Fn = () => void;
  function fakeEnv({ supported = true, rejectWithoutGesture = false, rejectAlways = false } = {}) {
    const listeners = new Map<string, Set<Fn>>();
    const on = (t: string, fn: Fn) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(fn);
    const off = (t: string, fn: Fn) => listeners.get(t)?.delete(fn);
    const fire = (t: string) => [...(listeners.get(t) ?? [])].forEach((fn) => fn());
    const state = { requests: 0, releases: 0, inGesture: false, sentinels: [] as { released: boolean; systemRelease(): void }[] };
    const doc = { visibilityState: 'visible', addEventListener: on, removeEventListener: off };
    const env: WakeLockEnv = {
      document: doc,
      window: { addEventListener: on, removeEventListener: off },
      wakeLock: supported
        ? {
            request: async () => {
              state.requests++;
              const gesture = state.inGesture;
              if (rejectAlways || (rejectWithoutGesture && !gesture)) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
              const rel = new Set<Fn>();
              const sentinel = {
                released: false,
                release: async () => {
                  if (sentinel.released) return;
                  sentinel.released = true;
                  state.releases++;
                  rel.forEach((fn) => fn());
                },
                addEventListener: (_: 'release', fn: Fn) => rel.add(fn),
                removeEventListener: (_: 'release', fn: Fn) => rel.delete(fn),
                systemRelease: () => void sentinel.release(),
              };
              state.sentinels.push(sentinel);
              return sentinel;
            },
          }
        : undefined,
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const setVisible = async (visible: boolean) => {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      fire('visibilitychange');
      await tick();
    };
    const tap = async () => {
      state.inGesture = true;
      fire('touchend');
      state.inGesture = false;
      await tick();
    };
    const count = (t: string) => listeners.get(t)?.size ?? 0;
    return { env, state, setVisible, tap, count, tick };
  }

  test('no indica «activo» hasta que el navegador lo concede', async () => {
    const { env, tick } = fakeEnv();
    const lock = createWebWakeLock(env);
    assert.equal(lock.status(), 'apagado');
    lock.start();
    assert.equal(lock.status(), 'solicitando');
    await tick();
    assert.equal(lock.status(), 'activo');
    assert.equal(lock.isHeld(), true);
  });

  test('lo libera al quedar oculta y lo vuelve a pedir al regresar', async () => {
    const { env, state, setVisible, tick } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    await tick();
    await setVisible(false);
    assert.equal(lock.isHeld(), false);
    assert.equal(lock.status(), 'en-pausa');
    assert.equal(state.releases, 1);
    await setVisible(true);
    assert.equal(lock.status(), 'activo');
    assert.equal(state.requests, 2);
  });

  test('si el sistema lo suelta con la app visible, lo recupera una vez y no entra en bucle', async () => {
    const { env, state, tap, setVisible, tick } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    await tick();
    state.sentinels.at(-1)!.systemRelease();
    await tick();
    assert.equal(lock.status(), 'activo');
    assert.equal(state.requests, 2);
    state.sentinels.at(-1)!.systemRelease();
    await tick();
    assert.equal(lock.status(), 'requiere-toque', 'el segundo «release» seguido espera un toque');
    assert.equal(state.requests, 2);
    await tap();
    assert.equal(lock.status(), 'activo');
    // Al volver a la app se reinicia el margen de reintento automático.
    await setVisible(false);
    await setVisible(true);
    state.sentinels.at(-1)!.systemRelease();
    await tick();
    assert.equal(lock.status(), 'activo');
  });

  test('si el navegador exige un toque (Safari), lo obtiene en el siguiente toque', async () => {
    const { env, state, tap, tick } = fakeEnv({ rejectWithoutGesture: true });
    const lock = createWebWakeLock(env);
    lock.start();
    await tick();
    assert.equal(lock.status(), 'requiere-toque');
    assert.equal(lock.lastError(), 'NotAllowedError');
    await tap();
    assert.equal(lock.status(), 'activo');
    await tap(); // ya concedido: no vuelve a pedir
    assert.equal(state.requests, 2);
  });

  test('si el teléfono lo bloquea incluso con un toque, no insiste en cada toque; el botón reintenta', async () => {
    const { env, state, tap, tick } = fakeEnv({ rejectAlways: true });
    const lock = createWebWakeLock(env);
    lock.start();
    await tick();
    await tap();
    assert.equal(lock.status(), 'bloqueado');
    const before = state.requests;
    await tap();
    await tap();
    assert.equal(state.requests, before);
    assert.equal(await lock.retry(), false);
    assert.equal(state.requests, before + 1);
  });

  test('sin solicitudes simultáneas ni listeners duplicados; al detenerlo libera y deja de escuchar', async () => {
    const { env, state, count, setVisible, tick } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    lock.start();
    void lock.retry();
    void lock.retry();
    await tick();
    assert.equal(state.requests, 1);
    assert.equal(count('visibilitychange'), 1);
    assert.equal(count('touchend'), 1);
    lock.stop();
    assert.equal(lock.isHeld(), false);
    assert.equal(lock.status(), 'apagado');
    assert.equal(count('visibilitychange'), 0);
    assert.equal(count('touchend'), 0);
    assert.equal(count('pageshow'), 0);
    await setVisible(false);
    await setVisible(true);
    assert.equal(state.requests, 1, 'detenido no vuelve a pedir');
  });

  test('si se oculta mientras se pide, lo suelta al llegar', async () => {
    const { env, state, tick } = fakeEnv();
    const lock = createWebWakeLock(env);
    lock.start();
    env.document.visibilityState = 'hidden';
    await tick();
    assert.equal(lock.isHeld(), false);
    assert.equal(state.releases, 1);
    assert.equal(lock.status(), 'en-pausa');
  });

  test('sin soporte no falla e informa «sin-soporte»', async () => {
    const { env, tick } = fakeEnv({ supported: false });
    const lock = createWebWakeLock(env);
    assert.equal(lock.supported, false);
    lock.start();
    await tick();
    assert.equal(lock.status(), 'sin-soporte');
    assert.equal(await lock.retry(), false);
    lock.stop();
  });
});
