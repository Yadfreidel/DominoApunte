/// <reference types="node" />
// Narrador: anuncios correctos según el estado real (líder, remontada, cercanía, victoria, retos).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { challengeGameSetup, challengeProgress, createChallenge } from '../src/domain/challenge.ts';
import { addHand, createGame, type Game } from '../src/domain/game.ts';
import { challengeNarration, comebackDeficit, handNarrations, nearThreshold, startNarration, victoryNarration } from '../src/domain/narrator.ts';

let n = 0;
const ids = () => `n${++n}`;
const T = '2026-10-20T20:00:00.000Z';

function game(target = 100, mode: 'individual' | 'parejas' = 'individual'): Game {
  return mode === 'parejas'
    ? createGame({ playerCount: 4, names: ['Juan', 'Pedro', 'Luis', 'Carlos'], mode, target }, T, ids)
    : createGame({ playerCount: 2, names: ['Ana', 'Beto'], mode, target }, T, ids);
}
/** Registra una mano y devuelve [antes, después, anuncios]. */
function hand(g: Game, side: number, points: number): [Game, string[]] {
  const next = addHand(g, g.sides[side].id, points, ids(), T);
  return [next, handNarrations(g, next).map((x) => x.text)];
}

describe('narrador', () => {
  test('umbrales adaptados a la meta y documentados', () => {
    assert.equal(nearThreshold(100), 10);
    assert.equal(nearThreshold(200), 20);
    assert.equal(nearThreshold(50), 10);
    assert.equal(comebackDeficit(100), 25);
    assert.equal(comebackDeficit(200), 50);
    assert.equal(comebackDeficit(40), 15);
  });

  test('la primera ventaja no es cambio de líder; el empate tampoco; el cambio real sí', () => {
    let g = game();
    let said: string[];
    [g, said] = hand(g, 0, 10);
    assert.deepEqual(said, []);
    [g, said] = hand(g, 1, 10); // empate
    assert.deepEqual(said, []);
    [g, said] = hand(g, 1, 5); // Beto pasa adelante (antes lideraba Ana)
    assert.deepEqual(said, ['¡Beto toma la delantera!']);
    [g, said] = hand(g, 1, 5); // sigue liderando
    assert.deepEqual(said, []);
  });

  test('parejas: «toman la delantera»', () => {
    let g = game(100, 'parejas');
    let said: string[];
    [g, said] = hand(g, 1, 5);
    [g, said] = hand(g, 0, 10);
    assert.deepEqual(said, ['¡Juan y Pedro toman la delantera!']);
  });

  test('remontada: pasar al frente después de ir al menos 25 % de la meta abajo', () => {
    let g = game();
    let said: string[];
    [g, said] = hand(g, 0, 30); // Ana 30 - Beto 0: Beto llega a ir 30 abajo (≥ 25)
    [g, said] = hand(g, 1, 35);
    assert.deepEqual(said, ['¡Remontada! Beto pasa al frente después de ir 30 puntos abajo.']);
    // Con un déficit menor es solo cambio de líder.
    let h = game();
    [h, said] = hand(h, 0, 20);
    [h, said] = hand(h, 1, 25);
    assert.deepEqual(said, ['¡Beto toma la delantera!']);
  });

  test('cerca de ganar: al entrar en la zona, con la cantidad exacta, una sola vez', () => {
    let g = game();
    let said: string[];
    [g, said] = hand(g, 0, 85); // faltan 15: aún no
    assert.deepEqual(said, []);
    [g, said] = hand(g, 0, 7); // faltan 8
    assert.deepEqual(said, ['¡Ana está a 8 puntos de ganar!']);
    [g, said] = hand(g, 0, 1); // sigue en la zona: no repite
    assert.deepEqual(said, []);
  });

  test('la victoria tiene prioridad: la mano ganadora no anuncia cercanía ni líder', () => {
    let g = game();
    let said: string[];
    [g, said] = hand(g, 1, 50);
    [g, said] = hand(g, 0, 100);
    assert.deepEqual(said, []);
    assert.equal(victoryNarration(g)!.text, '¡Gana Ana! Marcador final: 100 a 50.');
    assert.equal(victoryNarration(g)!.id, `${g.id}:victoria`);
  });

  test('victoria por parejas con nombre de equipo y nombres de los integrantes', () => {
    let g = createGame({ playerCount: 4, names: ['Juan', 'Pedro', 'Luis', 'Carlos'], mode: 'parejas', target: 100, teamNames: ['Los Tigres', ''] }, T, ids);
    g = addHand(g, g.sides[1].id, 40, ids(), T);
    g = addHand(g, g.sides[0].id, 110, ids(), T);
    assert.equal(victoryNarration(g)!.text, '¡Ganan Los Tigres: Juan y Pedro! Marcador final: 110 a 40.');
  });

  test('identificadores estables: el mismo evento siempre tiene el mismo id', () => {
    const g = game();
    assert.equal(startNarration(g).id, startNarration({ ...g }).id);
    const a = addHand(g, g.sides[0].id, 95, 'mano-1', T);
    assert.deepEqual(
      handNarrations(g, a).map((x) => x.id),
      handNarrations(g, a).map((x) => x.id),
    );
    // Recalcular con la misma partida (renderizado, sincronización) no genera una mano nueva.
    assert.deepEqual(handNarrations(a, a), []);
  });

  test('retos: avance de la serie y campeón', () => {
    const ch = createChallenge(
      { name: 'Revancha', kind: 'primero', mode: 'individual', names: ['Ana', 'Beto'], target: 100, winsNeeded: 2, timeZone: 'UTC' },
      T,
      ids,
    );
    const finish = (winner: number, at: string) => {
      const g = createGame(challengeGameSetup(ch), at, ids);
      return addHand(g, g.sides[winner].id, 100, ids(), at);
    };
    const g1 = finish(0, '2026-10-20T20:00:00.000Z');
    const p0 = challengeProgress(ch, [], T);
    const p1 = challengeProgress(ch, [g1], '2026-10-20T20:01:00.000Z');
    assert.equal(challengeNarration(ch, p0, p1, g1.id)!.text, '¡La serie está uno a cero para Ana!');
    const g2 = finish(0, '2026-10-20T21:00:00.000Z');
    const p2 = challengeProgress(ch, [g1, g2], '2026-10-20T21:01:00.000Z');
    assert.equal(challengeNarration(ch, p1, p2, g2.id)!.text, '¡Tenemos campeón del reto Revancha: Ana!');
    // Repetir con el mismo progreso (renderizado o sincronización) no anuncia nada.
    assert.equal(challengeNarration(ch, p2, p2, g2.id), null);
  });
});
