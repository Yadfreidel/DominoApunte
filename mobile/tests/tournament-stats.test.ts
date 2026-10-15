/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DrawError, drawIndex, drawPairs, seededRng, shuffle } from '../src/domain/draw.ts';
import { addHand, cancelGame, createGame, editHand, type Game, type Mode } from '../src/domain/game.ts';
import { migrateGames, resolvePlayers } from '../src/domain/players.ts';
import { computePersonStats, headToHead, rivalOptions, teamKey } from '../src/domain/stats.ts';
import { buildSummarySvg } from '../src/domain/summary.ts';
import {
  createTournament,
  lockReason,
  matchGameSetup,
  resolveTournament,
  roundName,
  TournamentError,
  type Tournament,
  type TournamentInput,
} from '../src/domain/tournament.ts';

let n = 0;
const ids = () => `x${++n}`;
let clock = Date.parse('2026-10-15T18:00:00.000Z');
const tick = () => new Date((clock += 60_000)).toISOString();

const players = (count: number) => Array.from({ length: count }, (_, i) => ({ playerId: `p${i + 1}`, name: `Jugador ${i + 1}` }));

function individualInput(count: number, target = 50): TournamentInput {
  return { name: 'Copa', mode: 'individual', target, entrants: players(count).map((p) => ({ players: [p] })) };
}

/** Juega un enfrentamiento listo: el lado `winnerSide` (0 o 1) anota la meta de una vez. */
function play(t: Tournament, games: Game[], matchId: string, winnerSide = 0): Game {
  const m = resolveTournament(t, games).rounds.flat().find((x) => x.id === matchId)!;
  let g = createGame(matchGameSetup(t, m), tick(), ids);
  g = addHand(g, g.sides[winnerSide].id, t.target, ids(), tick());
  games.push(g);
  return g;
}

/** Juega todo el torneo hasta el final, ganando siempre el lado A. */
function playAll(t: Tournament, games: Game[]) {
  for (;;) {
    const ready = resolveTournament(t, games).rounds.flat().find((m) => m.state === 'listo');
    if (!ready) break;
    play(t, games, ready.id);
  }
}

describe('torneo: cuadro y pases automáticos', () => {
  for (const count of [2, 3, 5, 6, 8, 13]) {
    test(`${count} participantes`, () => {
      const t = createTournament(individualInput(count), tick(), seededRng(count), ids);
      const size = 2 ** Math.ceil(Math.log2(count));
      assert.equal(t.rounds.length, Math.log2(size));
      const first = resolveTournament(t, []).rounds[0];
      const byes = first.filter((m) => m.isBye);
      assert.equal(byes.length, size - count, 'pases automáticos');
      assert.ok(first.every((m) => m.a), 'ningún cruce queda vacío (nunca pase contra pase)');
      const placed = first.flatMap((m) => [m.a?.id, m.b?.id]).filter(Boolean);
      assert.equal(new Set(placed).size, count, 'cada participante aparece una sola vez');
      assert.ok(byes.every((m) => m.state === 'pase' && m.winner?.id === m.a?.id && !m.game));
    });
  }

  test('nombres de ronda', () => {
    assert.deepEqual([0, 1, 2, 3].map((r) => roundName(r, 4)), ['Octavos de final', 'Cuartos de final', 'Semifinal', 'Final']);
    assert.deepEqual([0, 1].map((r) => roundName(r, 2)), ['Semifinal', 'Final']);
    assert.equal(roundName(0, 5), 'Ronda 1');
    assert.equal(roundName(1, 5), 'Octavos de final');
    assert.equal(roundName(4, 5), 'Final');
  });

  test('valida participantes y parejas', () => {
    assert.throws(() => createTournament(individualInput(1), tick()), /al menos 2/);
    const dup: TournamentInput = { name: 'X', mode: 'individual', target: 50, entrants: [{ players: [players(1)[0]] }, { players: [players(1)[0]] }] };
    assert.throws(() => createTournament(dup, tick()), /más de una vez/);
    const badPair: TournamentInput = { name: 'X', mode: 'parejas', target: 50, entrants: [{ players: players(2) }, { players: [players(3)[2]] }] };
    assert.throws(() => createTournament(badPair, tick()), TournamentError);
  });
});

describe('torneo: avance, campeón y bloqueos', () => {
  test('solo avanza el ganador de una partida terminada y se declara campeón', () => {
    const t = createTournament(individualInput(5), tick(), seededRng(7), ids);
    const games: Game[] = [];
    let r = resolveTournament(t, games);
    const ready = r.rounds[0].find((m) => m.state === 'listo')!;
    // partida empezada pero sin terminar: nadie avanza
    let g = createGame(matchGameSetup(t, ready), tick(), ids);
    g = addHand(g, g.sides[1].id, 10, ids(), tick());
    games.push(g);
    r = resolveTournament(t, games);
    const m = r.rounds[0].find((x) => x.id === ready.id)!;
    assert.equal(m.state, 'en_juego');
    assert.equal(m.winner, null);
    // termina: gana el lado B y aparece en la ronda siguiente
    games[0] = addHand(g, g.sides[1].id, t.target, ids(), tick());
    r = resolveTournament(t, games);
    const done = r.rounds[0].find((x) => x.id === ready.id)!;
    assert.equal(done.state, 'terminado');
    assert.equal(done.winner?.id, ready.b!.id);
    const next = r.rounds[1][Math.floor(done.index / 2)];
    assert.ok(next.a?.id === ready.b!.id || next.b?.id === ready.b!.id);

    playAll(t, games);
    r = resolveTournament(t, games);
    assert.equal(r.status, 'terminado');
    assert.ok(r.champion);
    assert.equal(r.finishedAt, r.rounds.at(-1)![0].game!.finishedAt);
  });

  test('no se puede cambiar un resultado si el enfrentamiento siguiente ya empezó', () => {
    const t = createTournament(individualInput(4), tick(), seededRng(3), ids);
    const games: Game[] = [];
    const [m0, m1] = resolveTournament(t, games).rounds[0];
    const g0 = play(t, games, m0.id);
    assert.equal(lockReason(t, games, g0), null, 'se puede corregir mientras la final no empezó');
    // corregir antes de la final cambia quién avanza
    const fixed = editHand(g0, g0.hands[0].id, { sideId: g0.sides[1].id }, tick());
    games[0] = fixed;
    assert.equal(resolveTournament(t, games).rounds[0][0].winner?.id, m0.b!.id);
    play(t, games, m1.id);
    const final = resolveTournament(t, games).rounds[1][0];
    assert.equal(final.state, 'listo');
    play(t, games, final.id);
    assert.match(lockReason(t, games, games[0])!, /final ya empezó/);
  });

  test('los pases automáticos no cuentan como victorias en estadísticas', () => {
    const t = createTournament(individualInput(3), tick(), seededRng(11), ids);
    const games: Game[] = [];
    const bye = resolveTournament(t, games).rounds[0].find((m) => m.isBye)!;
    playAll(t, games);
    const stats = computePersonStats(games).individual;
    const byePlayer = stats.find((s) => s.key === bye.a!.players[0].playerId);
    // solo jugó la final (una partida real), no el pase
    assert.equal(byePlayer?.played, 1);
  });

  test('partida de torneo cancelada: el enfrentamiento vuelve a estar listo', () => {
    const t = createTournament(individualInput(2), tick(), seededRng(1), ids);
    const games: Game[] = [];
    const m = resolveTournament(t, games).rounds[0][0];
    games.push(cancelGame(createGame(matchGameSetup(t, m), tick(), ids), tick()));
    assert.equal(resolveTournament(t, games).rounds[0][0].state, 'listo');
  });

  test('torneo por parejas: las parejas quedan fijas y el resultado se atribuye a ambos', () => {
    const p = players(8);
    const input: TournamentInput = {
      name: 'Parejas',
      mode: 'parejas',
      target: 50,
      entrants: [0, 1, 2, 3].map((i) => ({ name: `Equipo ${i + 1}`, players: [p[i * 2], p[i * 2 + 1]] })),
    };
    const t = createTournament(input, tick(), seededRng(5), ids);
    const games: Game[] = [];
    playAll(t, games);
    const r = resolveTournament(t, games);
    assert.equal(r.status, 'terminado');
    const champs = r.champion!.players.map((x) => x.playerId);
    const stats = computePersonStats(games).parejas;
    for (const id of champs) assert.equal(stats.find((s) => s.key === id)!.wins, 2);
    // las partidas usan exactamente las parejas del torneo
    for (const g of games) {
      for (const side of g.sides) {
        const entrant = t.entrants.find((e) => e.id === side.entrantId)!;
        assert.deepEqual(
          side.participantIds.map((pid) => g.participants.find((x) => x.id === pid)!.playerId).sort(),
          entrant.players.map((x) => x.playerId).sort(),
        );
      }
    }
  });
});

function quickGame(mode: Mode, names: string[], playerIds: string[], winner: number, scores: number[], extra: Partial<Game> = {}): Game {
  let g = createGame({ playerCount: names.length, names, playerIds, mode, target: 100 }, tick(), ids);
  scores.forEach((pts, i) => {
    if (pts > 0 && i !== winner) g = addHand(g, g.sides[i].id, pts, ids(), tick());
  });
  g = addHand(g, g.sides[winner].id, scores[winner], ids(), tick());
  return { ...g, ...extra };
}

describe('estadísticas personales', () => {
  test('jugadas, ganadas, perdidas, %, promedio y mejor racha; excluye canceladas y prácticas', () => {
    const ind = (w: number, sa: number, sb: number) => quickGame('individual', ['Ana', 'Luis'], ['pa', 'pl'], w, [sa, sb]);
    const games = [ind(0, 100, 20), ind(0, 120, 0), ind(1, 30, 100), ind(0, 100, 90)];
    games.push({ ...ind(1, 0, 100), practice: true }); // práctica: no cuenta
    let cancelled = createGame({ playerCount: 2, names: ['Ana', 'Luis'], playerIds: ['pa', 'pl'], mode: 'individual', target: 100 }, tick(), ids);
    cancelled = cancelGame(addHand(cancelled, cancelled.sides[1].id, 40, ids(), tick()), tick());
    games.push(cancelled);
    const s = computePersonStats(games).individual;
    const ana = s.find((x) => x.key === 'pa')!;
    assert.deepEqual([ana.played, ana.wins, ana.losses, ana.winRate, ana.bestStreak], [4, 3, 1, 75, 2]);
    assert.equal(ana.avgPoints, (100 + 120 + 30 + 100) / 4);
    const luis = s.find((x) => x.key === 'pl')!;
    assert.deepEqual([luis.wins, luis.losses, luis.bestStreak, luis.winRate], [1, 3, 1, 25]);
  });

  test('parejas: ambos integrantes reciben el resultado y el promedio son puntos del equipo', () => {
    const g = quickGame('parejas', ['Ana', 'Luis', 'Marta', 'Pedro'], ['pa', 'pl', 'pm', 'pp'], 0, [100, 40]);
    const s = computePersonStats([g]);
    assert.equal(s.individual.length, 0, 'separadas por modalidad');
    const byKey = Object.fromEntries(s.parejas.map((x) => [x.key, x]));
    assert.deepEqual([byKey.pa.wins, byKey.pl.wins, byKey.pm.losses, byKey.pp.losses], [1, 1, 1, 1]);
    assert.equal(byKey.pa.avgPoints, 100);
    assert.equal(byKey.pm.avgPoints, 40);
  });

  test('sin partidas válidas no hay división por cero', () => {
    const s = computePersonStats([]);
    assert.deepEqual(s, { individual: [], parejas: [] });
  });

  test('una corrección actualiza las estadísticas', () => {
    let g = quickGame('individual', ['Ana', 'Luis'], ['pa', 'pl'], 0, [100, 0]);
    assert.equal(computePersonStats([g]).individual.find((x) => x.key === 'pa')!.wins, 1);
    g = editHand(g, g.hands[0].id, { sideId: g.sides[1].id }, tick());
    const s = computePersonStats([g]).individual;
    assert.equal(s.find((x) => x.key === 'pl')!.wins, 1);
    assert.equal(s.find((x) => x.key === 'pa')!.wins, 0);
  });
});

describe('historial entre rivales', () => {
  test('parejas identificadas por sus integrantes sin importar orden ni nombre del equipo', () => {
    const g1 = quickGame('parejas', ['Ana', 'Luis', 'Marta', 'Pedro'], ['pa', 'pl', 'pm', 'pp'], 0, [100, 60]);
    const g2 = { ...quickGame('parejas', ['Pedro', 'Marta', 'Luis', 'Ana'], ['pp', 'pm', 'pl', 'pa'], 0, [100, 80]) };
    g2.sides = g2.sides.map((s, i) => ({ ...s, name: i === 0 ? 'Los Reyes' : 'Otro nombre' }));
    const ab = teamKey(['pl', 'pa']);
    const cd = teamKey(['pm', 'pp']);
    const h = headToHead([g1, g2], 'parejas', ab, cd);
    assert.equal(h.encounters.length, 2);
    assert.deepEqual([h.winsA, h.winsB], [1, 1]);
    const e1 = h.encounters.find((e) => e.gameId === g1.id)!;
    assert.deepEqual([e1.scoreA, e1.scoreB, e1.winner], [100, 60, 'a']);
    assert.equal(headToHead([g1, g2], 'individual', 'pa', 'pm').encounters.length, 0, 'modalidades separadas');
    assert.equal(rivalOptions([g1, g2], 'parejas').length, 2);
  });

  test('individual con tres jugadores: si gana otro, no suma a ninguno', () => {
    const g = quickGame('individual', ['Ana', 'Luis', 'Rosa'], ['pa', 'pl', 'pr'], 2, [20, 10, 100]);
    const h = headToHead([g], 'individual', 'pa', 'pl');
    assert.deepEqual([h.winsA, h.winsB, h.others], [0, 0, 1]);
  });

  test('sin encuentros devuelve lista vacía', () => {
    assert.deepEqual(headToHead([], 'individual', 'pa', 'pl'), { encounters: [], winsA: 0, winsB: 0, others: 0 });
  });
});

describe('sorteos', () => {
  test('parejas aleatorias sin repetir a nadie; exige cantidad par', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'];
    const pairs = drawPairs(list, seededRng(9));
    assert.equal(pairs.length, 3);
    assert.deepEqual(pairs.flat().sort(), list);
    assert.throws(() => drawPairs(['a', 'b', 'c']), DrawError);
    assert.throws(() => drawPairs(['a']), /al menos 2/);
  });

  test('reproducible con la misma semilla y dentro de rango', () => {
    assert.deepEqual(shuffle([1, 2, 3, 4, 5], seededRng(4)), shuffle([1, 2, 3, 4, 5], seededRng(4)));
    for (let i = 0; i < 50; i++) {
      const k = drawIndex(4, seededRng(i));
      assert.ok(k >= 0 && k < 4);
    }
  });
});

describe('registro de jugadores y migración', () => {
  test('mismo nombre, mismo id; partidas antiguas se vinculan por nombre', () => {
    const r = resolvePlayers([], ['Ana', ' ana ', 'Luis'], tick(), ids);
    assert.equal(r.ids[0], r.ids[1]);
    assert.equal(r.registry.length, 2);
    const old = createGame({ playerCount: 2, names: ['ANA', 'Rosa'], mode: 'individual', target: 100 }, tick(), ids);
    assert.equal(old.participants[0].playerId, undefined);
    const m = migrateGames([old], r.registry, tick(), ids);
    assert.equal(m.games[0].participants[0].playerId, r.ids[0]);
    assert.equal(m.registry.length, 3, 'Rosa se registra');
    assert.equal(m.changed.length, 1);
    assert.equal(migrateGames(m.games, m.registry, tick(), ids).changed.length, 0, 'idempotente');
  });
});

describe('resumen para compartir', () => {
  test('incluye nombres, ganador, marcador, meta y desglose; escapa texto', () => {
    let g = createGame({ playerCount: 2, names: ['Ana <3', 'Luis & Co'], mode: 'individual', target: 50 }, '2026-10-15T18:00:00.000Z', ids);
    g = addHand(g, g.sides[1].id, 20, ids(), '2026-10-15T18:10:00.000Z');
    g = addHand(g, g.sides[0].id, 55, ids(), '2026-10-15T18:25:00.000Z');
    const { svg, height } = buildSummarySvg(g);
    assert.match(svg, /DOMINÓ/);
    assert.match(svg, /GANADOR/);
    assert.match(svg, /Ana &lt;3/);
    assert.match(svg, /Luis &amp; Co/);
    assert.match(svg, /Meta: 50 puntos/);
    assert.match(svg, /Duración: 25 min/);
    assert.match(svg, />55</);
    assert.ok(height > 900);
  });

  test('sin fechas válidas no muestra duración', () => {
    let g = createGame({ playerCount: 2, names: ['Ana', 'Luis'], mode: 'individual', target: 50 }, 'fecha-rota', ids);
    g = addHand(g, g.sides[0].id, 55, ids(), '2026-10-15T18:25:00.000Z');
    assert.doesNotMatch(buildSummarySvg(g).svg, /Duración/);
  });
});

describe('persistencia de registro, torneos y sorteo', () => {
  test('al abrir: migra partidas antiguas, conserva torneos y el sorteo confirmado', async () => {
    const { KEYS, MemoryStorage, Repository } = await import('../src/domain/repository.ts');
    const storage = new MemoryStorage();
    const repo = new Repository(storage);
    await repo.load();
    const old = createGame({ playerCount: 2, names: ['Ana', 'Luis'], mode: 'individual', target: 100 }, tick(), ids);
    await repo.saveGame(old);
    await storage.setItem(KEYS.players, JSON.stringify(['Ana', 'Rosa']));
    const t = createTournament(individualInput(3), tick(), seededRng(2), ids);
    await repo.saveTournament(t);
    await repo.saveDraft({ mode: 'parejas', countChoice: 4, names: ['A', 'B', 'C', 'D'], teamNames: ['', ''], starterIndex: 2, practice: false });

    const reopened = new Repository(storage);
    const data = await reopened.load();
    const ana = data.players.find((p) => p.name === 'Ana')!;
    assert.equal(data.games[0].participants[0].playerId, ana.id, 'vinculada por nombre');
    assert.deepEqual(data.players.map((p) => p.name).sort(), ['Ana', 'Luis', 'Rosa']);
    assert.equal(data.tournaments[0].id, t.id);
    assert.equal((await reopened.loadDraft())!.starterIndex, 2, 'el sorteo no se repite al recargar');
    // la migración quedó guardada: una segunda apertura no cambia ids
    const again = await new Repository(storage).load();
    assert.equal(again.games[0].participants[0].playerId, ana.id);
  });
});
