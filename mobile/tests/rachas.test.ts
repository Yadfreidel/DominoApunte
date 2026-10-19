/// <reference types="node" />
// Rachas, parejas fijas, rivalidades y tarjeta del ganador.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addHand, cancelGame, createGame, createRematch, editHand, type Game } from '../src/domain/game.ts';
import type { PlayerRecord } from '../src/domain/players.ts';
import { computePersonStats, computeTeamStats, currentStreakOf, headToHead, matchupNote, rivalrySummary, teamKey } from '../src/domain/stats.ts';
import { buildWinnerCardSvg, celebrationPhrase } from '../src/domain/winnerCard.ts';

let n = 0;
const ids = () => `r${++n}`;
const at = (day: number, min = 0) => `2026-10-${String(day).padStart(2, '0')}T20:${String(min).padStart(2, '0')}:00.000Z`;
const registry: PlayerRecord[] = ['Juan', 'Pedro', 'Luis', 'Carlos'].map((name) => ({ id: `id-${name}`, name, createdAt: at(1) }));
const pid = (name: string) => `id-${name}`;

/** Partida individual terminada en un momento dado; gana `winner` (0 o 1). */
function single(a: string, b: string, winner: 0 | 1, day: number, target = 100): Game {
  const g = createGame({ playerCount: 2, names: [a, b], playerIds: [pid(a), pid(b)], mode: 'individual', target }, at(day), ids);
  return addHand(g, g.sides[winner].id, target, ids(), at(day, 30));
}
/** Partida por parejas: [a1, a2] contra [b1, b2]. */
function pairs(a: [string, string], b: [string, string], winner: 0 | 1, day: number, teamNames?: [string, string]): Game {
  const g = createGame(
    { playerCount: 4, names: [...a, ...b], playerIds: [...a, ...b].map(pid), mode: 'parejas', target: 100, teamNames },
    at(day),
    ids,
  );
  return addHand(g, g.sides[winner].id, 100, ids(), at(day, 30));
}

describe('rachas', () => {
  test('racha actual y mejor racha en orden cronológico, sin depender del orden de sincronización', () => {
    const games = [
      single('Juan', 'Luis', 0, 2),
      single('Juan', 'Luis', 0, 3),
      single('Juan', 'Luis', 1, 4), // derrota: corta la racha
      single('Juan', 'Luis', 0, 5),
      single('Juan', 'Luis', 0, 6),
      single('Juan', 'Luis', 0, 7),
    ];
    const shuffled = [games[4], games[0], games[5], games[2], games[1], games[3]];
    const juan = computePersonStats(shuffled, registry).individual.find((p) => p.key === pid('Juan'))!;
    assert.equal(juan.currentStreak, 3);
    assert.equal(juan.bestStreak, 3);
    const luis = computePersonStats(shuffled, registry).individual.find((p) => p.key === pid('Luis'))!;
    assert.equal(luis.currentStreak, 0);
    assert.equal(luis.bestStreak, 1);
  });

  test('canceladas, sin terminar y de práctica no cortan ni alargan la racha', () => {
    const setup = (practice = false) => ({
      playerCount: 2,
      names: ['Juan', 'Luis'],
      playerIds: [pid('Juan'), pid('Luis')],
      mode: 'individual' as const,
      target: 100,
      practice,
    });
    const won1 = single('Juan', 'Luis', 0, 2);
    const cancelled = cancelGame(createGame(setup(), at(3), ids), at(3, 5));
    const pending = createGame(setup(), at(4), ids);
    const p = createGame(setup(true), at(5), ids);
    const practiceLost = addHand(p, p.sides[1].id, 100, ids(), at(5, 30)); // Luis gana una de práctica
    const won2 = single('Juan', 'Luis', 0, 6);
    assert.equal(currentStreakOf([won1, cancelled, pending, practiceLost, won2], 'individual', pid('Juan')), 2);
  });

  test('una corrección que cambia el ganador recalcula la racha', () => {
    const g1 = single('Juan', 'Luis', 0, 2);
    let g2 = single('Juan', 'Luis', 0, 3);
    assert.equal(currentStreakOf([g1, g2], 'individual', pid('Juan')), 2);
    // Se corrige la mano: los puntos eran de Luis.
    g2 = editHand(g2, g2.hands[0].id, { sideId: g2.sides[1].id }, at(3, 40));
    assert.equal(currentStreakOf([g1, g2], 'individual', pid('Juan')), 0);
    assert.equal(currentStreakOf([g1, g2], 'individual', pid('Luis')), 1);
  });

  test('la misma pareja se reconoce aunque cambie el orden o el nombre del equipo', () => {
    const games = [
      pairs(['Juan', 'Pedro'], ['Luis', 'Carlos'], 0, 2, ['Los Tigres', 'Rivales']),
      pairs(['Pedro', 'Juan'], ['Carlos', 'Luis'], 0, 3),
      pairs(['Luis', 'Carlos'], ['Juan', 'Pedro'], 1, 4),
      pairs(['Juan', 'Pedro'], ['Luis', 'Carlos'], 0, 5),
    ];
    const teams = computeTeamStats(games, registry);
    const jp = teams.find((t) => t.key === teamKey([pid('Juan'), pid('Pedro')]))!;
    assert.equal(jp.name, 'Juan y Pedro');
    assert.equal(jp.played, 4);
    assert.equal(jp.wins, 4);
    assert.equal(jp.currentStreak, 4);
    assert.equal(teams.find((t) => t.key === teamKey([pid('Luis'), pid('Carlos')]))!.losses, 4);
  });
});

describe('rivalidades', () => {
  test('serie, racha en la rivalidad y mensajes con datos reales', () => {
    const games = [
      ...[1, 2, 3, 4, 5].map((d) => pairs(['Luis', 'Carlos'], ['Juan', 'Pedro'], 0, d)),
      ...[6, 7, 8, 9].map((d) => pairs(['Juan', 'Pedro'], ['Luis', 'Carlos'], 0, d)),
    ];
    const a = teamKey([pid('Juan'), pid('Pedro')]);
    const b = teamKey([pid('Luis'), pid('Carlos')]);
    const h = headToHead(games, 'parejas', a, b);
    const r = rivalrySummary(h, 'Juan y Pedro', 'Luis y Carlos', true);
    assert.equal(r.total, 9);
    assert.equal(r.winsA, 4);
    assert.equal(r.winsB, 5);
    assert.deepEqual(r.streak, { side: 'a', count: 4 });
    assert.ok(r.messages.includes('Juan y Pedro llevan 4 victorias seguidas contra Luis y Carlos.'), r.messages.join(' | '));
    assert.ok(r.messages.includes('La serie está 5 a 4 para Luis y Carlos; Juan y Pedro pueden empatar en la próxima.'), r.messages.join(' | '));
    assert.deepEqual(r.recent, ['a', 'a', 'a', 'a', 'b']);
  });

  test('no mezcla modalidades y da una nota antes de jugar solo si ya se enfrentaron', () => {
    const games = [single('Juan', 'Luis', 0, 2), pairs(['Juan', 'Pedro'], ['Luis', 'Carlos'], 1, 3)];
    assert.equal(headToHead(games, 'individual', pid('Juan'), pid('Luis')).encounters.length, 1);
    assert.equal(matchupNote(games, 'individual', [['Juan'], ['Luis']], registry, ['Juan', 'Luis']), 'La serie está 1 a 0 para Juan; Luis puede empatar en la próxima.');
    assert.equal(matchupNote(games, 'individual', [['Juan'], ['Desconocido']], registry, ['Juan', 'Desconocido']), null);
    assert.equal(matchupNote(games, 'individual', [['Pedro'], ['Carlos']], registry, ['Pedro', 'Carlos']), null);
  });
});

describe('tarjeta del ganador', () => {
  test('se genera desde la partida guardada aunque ya empezó la siguiente en cero', () => {
    const finished = pairs(['Juan', 'Pedro'], ['Luis', 'Carlos'], 0, 2);
    const next = createRematch(finished, at(2, 45), ids);
    assert.equal(next.hands.length, 0);
    const card = buildWinnerCardSvg(finished, { appName: 'Dominó', streak: 3 })!;
    assert.ok(card.svg.includes('GANADORES'));
    assert.ok(card.svg.includes('Juan y Pedro'));
    assert.ok(card.svg.includes('>100<'), 'puntos finales');
    assert.ok(card.svg.includes('¡Meta exacta: 100 puntos!'));
    assert.ok(card.svg.includes('Racha: 3 victorias seguidas'));
    assert.ok(card.svg.includes(celebrationPhrase(finished.id)));
    // Sin enlaces ni códigos (las declaraciones xmlns del formato SVG no son enlaces).
    assert.ok(!/https?:\/\//.test(card.svg.replace(/xmlns(:xlink)?="[^"]*"/g, '')), 'sin enlaces');
    assert.equal(buildWinnerCardSvg(next, { appName: 'Dominó' }), null, 'una partida sin terminar no tiene tarjeta');
  });

  test('sin racha calculada no la muestra; nombres largos, acentos y símbolos seguros', () => {
    const g = createGame({ playerCount: 2, names: ['José María <Pérez>', 'Luis'], mode: 'individual', target: 50 }, at(3), ids);
    const won = addHand(g, g.sides[0].id, 60, ids(), at(3, 20));
    const card = buildWinnerCardSvg(won, { appName: 'Club & Amigos' })!;
    assert.ok(!card.svg.includes('Racha:'));
    assert.ok(card.svg.includes('José María &lt;Pérez&gt;'));
    assert.ok(card.svg.includes('CLUB &amp; AMIGOS'));
    assert.ok(card.svg.includes('¡Se pasó por 10 puntos!'));
  });
});
