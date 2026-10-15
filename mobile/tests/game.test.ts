/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addHand,
  cancelGame,
  createGame,
  createRematch,
  formatDuration,
  gameDurationMs,
  editHand,
  filterGames,
  GameError,
  parsePoints,
  parseTarget,
  removeHand,
  runningTotals,
  totals,
  undoLastHand,
  validateSetup,
} from '../src/domain/game.ts';
import { KEYS, MemoryStorage, Repository } from '../src/domain/repository.ts';

const T = '2026-10-14T20:00:00.000Z';
let seq = 0;
const ids = () => `id${++seq}`;

function couples(target = 200) {
  return createGame(
    { playerCount: 4, names: ['Ana', 'Luis', 'Marta', 'Pedro'], mode: 'parejas', target },
    T,
    ids,
  );
}

describe('configuración de partida', () => {
  test('crea partida individual de 3 con marcadores en cero', () => {
    const g = createGame({ playerCount: 3, names: ['Ana', 'Luis', 'Marta', 'ignorado'], mode: 'individual', target: 150 }, T, ids);
    assert.equal(g.sides.length, 3);
    assert.equal(g.participants.length, 3);
    assert.deepEqual(Object.values(totals(g)), [0, 0, 0]);
    assert.equal(g.status, 'pendiente');
    assert.equal(g.target, 150);
  });

  test('parejas: el nombre de cada equipo se forma con sus jugadores', () => {
    const g = couples();
    assert.deepEqual(g.sides.map((s) => s.name), ['Ana y Luis', 'Marta y Pedro']);
    assert.equal(g.sides[0].participantIds.length, 2);
  });

  test('parejas: cada pareja necesita dos jugadores distintos y su nombre es editable', () => {
    assert.match(validateSetup({ playerCount: 4, names: ['Ana', '', 'Marta', 'Pedro'], mode: 'parejas', target: 100 })!, /pareja 1 necesita dos/);
    assert.match(validateSetup({ playerCount: 4, names: ['Ana', 'ana', 'Marta', 'Pedro'], mode: 'parejas', target: 100 })!, /dos veces/);
    assert.match(
      validateSetup({ playerCount: 4, names: ['Ana', 'Luis', 'Marta', 'Pedro'], playerIds: ['p1', 'p2', 'p1', 'p4'], mode: 'parejas', target: 100 })!,
      /dos veces/,
    );
    const named = createGame(
      { playerCount: 4, names: ['Ana', 'Luis', 'Marta', 'Pedro'], mode: 'parejas', target: 100, teamNames: ['Los Tigres', ''] },
      T,
      ids,
    );
    assert.deepEqual(named.sides.map((s) => s.name), ['Los Tigres', 'Marta y Pedro']);
    assert.equal(named.sides[0].participantIds.length, 2);
  });

  test('guarda identidad de jugadores, práctica y quién sale', () => {
    const g = createGame(
      { playerCount: 2, names: ['Ana', 'Luis'], playerIds: ['pA', 'pL'], mode: 'individual', target: 100, practice: true, starterIndex: 1 },
      T,
      ids,
    );
    assert.deepEqual(g.participants.map((p) => p.playerId), ['pA', 'pL']);
    assert.equal(g.practice, true);
    assert.equal(g.starterParticipantId, g.participants[1].id);
    const r = createRematch(g, T, ids);
    assert.deepEqual(r.participants.map((p) => p.playerId), ['pA', 'pL']);
    assert.equal(r.starterParticipantId, null);
  });

  test('valida la configuración', () => {
    assert.match(validateSetup({ playerCount: 3, names: ['A', 'B', 'C'], mode: 'parejas', target: 100 })!, /4 jugadores/);
    assert.match(validateSetup({ playerCount: 2, names: ['Ana', ' ana '], mode: 'individual', target: 100 })!, /dos veces/);
    assert.match(validateSetup({ playerCount: 2, names: ['Ana', '  '], mode: 'individual', target: 100 })!, /jugador 2/);
    assert.match(validateSetup({ playerCount: 5, names: [], mode: 'individual', target: 100 })!, /entre 2 y 4/);
    assert.equal(validateSetup({ playerCount: 2, names: ['Ana', 'Luis'], mode: 'individual', target: 175 }), null);
    assert.throws(() => createGame({ playerCount: 2, names: ['Ana', ''], mode: 'individual', target: 100 }, T), GameError);
  });
});

describe('validación de números', () => {
  test('solo enteros no negativos', () => {
    assert.deepEqual(parsePoints('25'), { ok: true, value: 25 });
    assert.deepEqual(parsePoints('0'), { ok: true, value: 0 });
    assert.equal(parsePoints('-5').ok, false);
    assert.equal(parsePoints('2.5').ok, false);
    assert.equal(parsePoints('').ok, false);
    assert.equal(parsePoints('1e3').ok, false);
    assert.equal(parsePoints('1001').ok, false);
    assert.equal(parseTarget('0').ok, false);
    assert.deepEqual(parseTarget('300'), { ok: true, value: 300 });
  });
});

describe('marcador', () => {
  test('suma manos y actualiza el total', () => {
    let g = couples();
    const [a, b] = g.sides;
    g = addHand(g, a.id, 25, 'h1', T);
    g = addHand(g, b.id, 10, 'h2', T);
    g = addHand(g, a.id, 15, 'h3', T);
    assert.deepEqual(totals(g), { [a.id]: 40, [b.id]: 10 });
    assert.deepEqual(runningTotals(g).map((r) => [r[a.id], r[b.id]]), [[25, 0], [25, 10], [40, 10]]);
    assert.equal(g.revision, 3);
  });

  test('no duplica una mano por pulsaciones repetidas', () => {
    let g = couples();
    const a = g.sides[0].id;
    g = addHand(g, a, 20, 'misma', T);
    const again = addHand(g, a, 20, 'misma', T);
    assert.equal(again, g);
    assert.equal(again.hands.length, 1);
  });

  test('declara ganador al alcanzar o superar la meta', () => {
    let g = couples(100);
    const [a, b] = g.sides;
    g = addHand(g, a.id, 60, 'h1', T);
    g = addHand(g, b.id, 99, 'h2', T);
    assert.equal(g.status, 'pendiente');
    g = addHand(g, a.id, 40, 'h3', T);
    assert.equal(g.status, 'terminada');
    assert.equal(g.winnerSideId, a.id);
    assert.equal(g.finishedAt, T);
    assert.throws(() => addHand(g, b.id, 5, 'h4', T), /terminó/);
  });

  test('editar una mano recalcula marcador y ganador', () => {
    let g = couples(100);
    const [a, b] = g.sides;
    g = addHand(g, a.id, 60, 'h1', T);
    g = addHand(g, a.id, 45, 'h2', T);
    assert.equal(g.winnerSideId, a.id);
    g = editHand(g, 'h2', { points: 5 }, T);
    assert.equal(g.status, 'pendiente');
    assert.equal(g.winnerSideId, null);
    assert.equal(totals(g)[a.id], 65);
    assert.ok(g.hands[1].editedAt);
    g = editHand(g, 'h1', { sideId: b.id }, T);
    assert.deepEqual(totals(g), { [a.id]: 5, [b.id]: 60 });
    assert.throws(() => editHand(g, 'h1', { points: -1 }, T), GameError);
  });

  test('deshacer la última mano reabre una partida terminada', () => {
    let g = couples(50);
    const a = g.sides[0].id;
    g = addHand(g, a, 30, 'h1', T);
    g = addHand(g, a, 30, 'h2', T);
    assert.equal(g.status, 'terminada');
    g = undoLastHand(g, T);
    assert.equal(g.status, 'pendiente');
    assert.equal(totals(g)[a], 30);
    g = undoLastHand(g, T);
    assert.throws(() => undoLastHand(g, T), /No hay manos/);
  });

  test('eliminar una mano intermedia recalcula marcador y ganador', () => {
    let g = couples(50);
    const [a, b] = g.sides;
    g = addHand(g, a.id, 30, 'h1', T);
    g = addHand(g, b.id, 10, 'h2', T);
    g = addHand(g, a.id, 25, 'h3', T);
    assert.equal(g.winnerSideId, a.id);
    g = removeHand(g, 'h1', T);
    assert.equal(g.status, 'pendiente');
    assert.deepEqual(totals(g), { [a.id]: 25, [b.id]: 10 });
    assert.deepEqual(g.hands.map((h) => h.id), ['h2', 'h3']);
    assert.throws(() => removeHand(g, 'no-existe', T), /no existe/);
  });

  test('revancha con los mismos participantes y marcadores en cero', () => {
    let g = couples(50);
    g = addHand(g, g.sides[1].id, 55, 'h1', T);
    const r = createRematch(g, T, ids);
    assert.notEqual(r.id, g.id);
    assert.equal(r.rematchOf, g.id);
    assert.deepEqual(r.participants.map((p) => p.name), ['Ana', 'Luis', 'Marta', 'Pedro']);
    assert.deepEqual(r.sides.map((s) => s.name), ['Ana y Luis', 'Marta y Pedro']);
    assert.equal(r.mode, 'parejas');
    assert.equal(r.target, 50);
    assert.deepEqual(Object.values(totals(r)), [0, 0]);
    assert.equal(r.status, 'pendiente');
  });

  test('una partida cancelada no admite cambios', () => {
    let g = couples();
    g = cancelGame(g, T);
    assert.equal(g.status, 'cancelada');
    assert.throws(() => addHand(g, g.sides[0].id, 5, 'x', T), /cancelada/);
    assert.throws(() => undoLastHand(g, T), /cancelada/);
  });
});

describe('historial y estadísticas', () => {
  test('filtra por fecha, jugador y estado', () => {
    const g1 = { ...couples(), createdAt: '2026-10-01T15:00:00.000Z' };
    const g2 = createGame({ playerCount: 2, names: ['Rosa', 'Juan'], mode: 'individual', target: 100 }, '2026-10-12T15:00:00.000Z', ids);
    const g3 = cancelGame(createGame({ playerCount: 2, names: ['Ana', 'Juan'], mode: 'individual', target: 100 }, '2026-10-13T15:00:00.000Z', ids), T);
    const all = [g1, g2, g3];
    assert.deepEqual(filterGames(all, { player: 'ana' }).map((g) => g.id), [g3.id, g1.id]);
    assert.deepEqual(filterGames(all, { from: '2026-10-10' }).map((g) => g.id), [g3.id, g2.id]);
    assert.deepEqual(filterGames(all, { to: '2026-10-05' }).map((g) => g.id), [g1.id]);
    assert.deepEqual(filterGames(all, { status: 'cancelada' }).map((g) => g.id), [g3.id]);
  });

  test('duración real solo con fechas de inicio y fin válidas', () => {
    let g = couples(50);
    assert.equal(gameDurationMs(g), null);
    g = addHand(g, g.sides[0].id, 50, 'h1', '2026-10-14T20:42:00.000Z');
    assert.equal(gameDurationMs(g), 42 * 60000);
    assert.equal(formatDuration(42 * 60000), '42 min');
    assert.equal(formatDuration(95 * 60000), '1 h 35 min');
    assert.equal(gameDurationMs({ ...g, finishedAt: '2026-10-14T19:00:00.000Z' }), null);
  });
});

describe('persistencia y recuperación', () => {
  test('recupera la partida en curso tras cerrar y abrir la app', async () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage);
    await repo.load();
    let g = couples();
    await repo.saveGame(g);
    await repo.setCurrent(g.id);
    g = addHand(g, g.sides[0].id, 30, 'h1', T);
    await repo.saveGame(g);
    g = addHand(g, g.sides[1].id, 15, 'h2', T);
    await repo.saveGame(g);

    // "Reinicio": un repositorio nuevo sobre el mismo almacenamiento.
    const reopened = await new Repository(storage).load();
    assert.equal(reopened.currentGameId, g.id);
    const restored = reopened.games.find((x) => x.id === g.id)!;
    assert.equal(restored.hands.length, 2);
    assert.deepEqual(totals(restored), totals(g));
  });

  test('ignora datos dañados sin perder el resto', async () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage);
    await repo.load();
    const g = couples();
    await repo.saveGame(g);
    await storage.setItem(KEYS.index, JSON.stringify([g.id, 'roto']));
    await storage.setItem(KEYS.game('roto'), '{no es json');
    const data = await new Repository(storage).load();
    assert.equal(data.games.length, 1);
    assert.deepEqual(data.corrupted, [KEYS.game('roto')]);
  });

  test('las fotos de jugadores se guardan, recuperan y borran', async () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage);
    await repo.load();
    await repo.savePhoto('ana', 'data:image/jpeg;base64,AAAA');
    await repo.savePhoto('luis', 'data:image/jpeg;base64,BBBB');
    await repo.savePhoto('ana', null);
    const data = await new Repository(storage).load();
    assert.deepEqual(data.photos, { luis: 'data:image/jpeg;base64,BBBB' });
  });

  test('las escrituras se aplican en orden', async () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage);
    await repo.load();
    let g = couples();
    const writes = [];
    for (let i = 0; i < 10; i++) {
      g = addHand(g, g.sides[0].id, i, `h${i}`, T);
      writes.push(repo.saveGame(g));
    }
    await Promise.all(writes);
    const saved = JSON.parse((await storage.getItem(KEYS.game(g.id)))!);
    assert.equal(saved.hands.length, 10);
  });
});
