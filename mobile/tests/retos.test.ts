/// <reference types="node" />
// Retos entre amigos: «primero en N victorias» y «serie por período».
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cancelChallenge,
  challengeGameSetup,
  challengeProgress,
  cannotStart,
  createChallenge,
  reconcileDeclared,
  reopenChallenge,
  seriesScore,
  validateChallengeInput,
  type Challenge,
} from '../src/domain/challenge.ts';
import { addHand, cancelGame, createGame, createRematch, editHand, type Game } from '../src/domain/game.ts';

let n = 0;
const ids = () => `c${++n}`;
const TZ = 'America/Santo_Domingo'; // UTC-4 todo el año
// Hora local de Santo Domingo → ISO UTC.
const local = (day: string, time = '20:00') => new Date(`${day}T${time}:00-04:00`).toISOString();

function primero(winsNeeded = 3): Challenge {
  return createChallenge(
    { name: 'Revancha', kind: 'primero', mode: 'parejas', names: ['Juan', 'Pedro', 'Luis', 'Carlos'], target: 100, winsNeeded, timeZone: TZ },
    local('2026-10-20', '10:00'),
    ids,
  );
}
function serie(tiePolicy: 'empate' | 'puntos' = 'empate'): Challenge {
  return createChallenge(
    { name: 'Fin de semana', kind: 'serie', mode: 'individual', names: ['Ana', 'Beto'], target: 100, startsOn: '2026-10-24', endsOn: '2026-10-25', timeZone: TZ, tiePolicy },
    local('2026-10-20', '10:00'),
    ids,
  );
}
/** Partida del reto que gana el lado `winner` con `points` puntos, terminada a la hora local dada. */
function play(ch: Challenge, winner: number, finishedAt: string, points = 100, loserPoints = 0): Game {
  const start = new Date(Date.parse(finishedAt) - 30 * 60_000).toISOString();
  let g = createGame(challengeGameSetup(ch), start, ids);
  if (loserPoints) g = addHand(g, g.sides[1 - winner].id, loserPoints, ids(), start);
  return addHand(g, g.sides[winner].id, points, ids(), finishedAt);
}

describe('retos: validación y configuración', () => {
  test('exige datos coherentes según la modalidad', () => {
    const base = { name: 'X', mode: 'individual' as const, names: ['A', 'B'], target: 100, timeZone: TZ };
    assert.match(validateChallengeInput({ ...base, kind: 'primero', winsNeeded: 0 })!, /victorias/);
    assert.match(validateChallengeInput({ ...base, kind: 'serie', startsOn: '2026-10-25', endsOn: '2026-10-24' })!, /cierre/);
    assert.match(validateChallengeInput({ ...base, kind: 'serie', startsOn: '2026-02-30', endsOn: '2026-03-01' })!, /fechas/);
    assert.match(validateChallengeInput({ ...base, kind: 'primero', winsNeeded: 3, names: ['A', 'a'] })!, /dos veces/);
    assert.equal(validateChallengeInput({ ...base, kind: 'primero', winsNeeded: 3 }), null);
  });

  test('la partida del reto usa sus participantes y reglas, y queda vinculada a él', () => {
    const ch = primero();
    const g = createGame(challengeGameSetup(ch), local('2026-10-20'), ids);
    assert.equal(g.challengeId, ch.id);
    assert.deepEqual(
      g.sides.map((s) => s.entrantId),
      ch.entrants.map((e) => e.id),
    );
    assert.equal(g.target, 100);
    assert.equal(g.mode, 'parejas');
  });
});

describe('retos: primero en ganar N', () => {
  test('cuenta victorias, se decide al llegar a N y deja de admitir partidas', () => {
    const ch = primero(2);
    const g1 = play(ch, 0, local('2026-10-20', '20:00'));
    const g2 = play(ch, 1, local('2026-10-20', '21:00'));
    let p = challengeProgress(ch, [g1, g2], local('2026-10-20', '22:00'));
    assert.equal(seriesScore(ch, p), 'empatada a 1');
    assert.equal(p.accepting, true);
    const g3 = play(ch, 0, local('2026-10-20', '22:00'));
    const late = play(ch, 1, local('2026-10-20', '23:00')); // terminó después de decidirse
    p = challengeProgress(ch, [g1, g2, g3, late], local('2026-10-20', '23:30'));
    assert.equal(p.state, 'completado');
    assert.deepEqual(p.winnerIds, [ch.entrants[0].id]);
    assert.equal(p.decidedBy, g3.id);
    assert.equal(p.accepting, false);
    assert.match(cannotStart(ch, p)!, /reabrir/);
    assert.equal(p.games.find((x) => x.game.id === late.id)!.verdict, 'tras-decision');
    assert.equal(p.rows[0].wins, 2);
  });

  test('una partida cuenta una sola vez aunque llegue repetida (p. ej. tras sincronizar)', () => {
    const ch = primero(3);
    const g1 = play(ch, 0, local('2026-10-20', '20:00'));
    const p = challengeProgress(ch, [g1, { ...g1 }, g1], local('2026-10-20', '22:00'));
    assert.equal(p.rows.find((r) => r.entrantId === ch.entrants[0].id)!.wins, 1);
  });

  test('canceladas, pendientes, de práctica e incompatibles no cuentan', () => {
    const ch = primero(3);
    const pending = createGame(challengeGameSetup(ch), local('2026-10-20'), ids);
    const cancelled = cancelGame(createGame(challengeGameSetup(ch), local('2026-10-20'), ids), local('2026-10-20', '20:10'));
    const practice = { ...play(ch, 0, local('2026-10-20', '20:30')), practice: true };
    const otherTarget = { ...play(ch, 0, local('2026-10-20', '20:40')), target: 150 };
    const p = challengeProgress(ch, [pending, cancelled, practice, otherTarget], local('2026-10-20', '22:00'));
    assert.deepEqual(
      p.games.map((x) => x.verdict).sort(),
      ['cancelada', 'en-curso', 'incompatible', 'practica'],
    );
    assert.ok(p.rows.every((r) => r.wins === 0));
  });

  test('una corrección que cambia el ganador se refleja y queda registrada; la reapertura es explícita', () => {
    let ch = primero(1);
    const g = play(ch, 0, local('2026-10-20', '20:00'));
    let p = challengeProgress(ch, [g], local('2026-10-20', '21:00'));
    ch = reconcileDeclared(ch, p, local('2026-10-20', '21:00'));
    assert.deepEqual(ch.declared!.winnerIds, [ch.entrants[0].id]);
    assert.match(ch.log.at(-1)!.text, /^Ganador: Juan y Pedro/);
    // Se corrige la mano: los puntos eran de la otra pareja.
    const fixed = editHand(g, g.hands[0].id, { sideId: g.sides[1].id }, local('2026-10-20', '21:05'));
    p = challengeProgress(ch, [fixed], local('2026-10-20', '21:10'));
    const before = ch;
    ch = reconcileDeclared(ch, p, local('2026-10-20', '21:10'));
    assert.match(ch.log.at(-1)!.text, /Corrección: el resultado cambió de Juan y Pedro a Luis y Carlos/);
    assert.equal(ch.revision, before.revision + 1);
    assert.equal(reconcileDeclared(ch, p, local('2026-10-20', '21:20')), ch, 'sin cambios no registra nada');
    // Reabrir exige subir las victorias necesarias por encima de las del líder.
    assert.throws(() => reopenChallenge(ch, p, 1, local('2026-10-20', '21:30')), /más de 1/);
    const reopened = reopenChallenge(ch, p, 3, local('2026-10-20', '21:30'));
    const p2 = challengeProgress(reopened, [fixed], local('2026-10-20', '21:31'));
    assert.equal(p2.accepting, true);
    assert.match(reopened.log.at(-1)!.text, /Reabierto/);
  });

  test('la revancha de una partida del reto sigue en el reto solo si se pide', () => {
    const ch = primero(3);
    const g = play(ch, 0, local('2026-10-20', '20:00'));
    const keep = createRematch(g, local('2026-10-20', '20:05'), ids, true);
    assert.equal(keep.challengeId, ch.id);
    assert.deepEqual(keep.sides.map((s) => s.entrantId), g.sides.map((s) => s.entrantId));
    assert.equal(createRematch(g, local('2026-10-20', '20:05'), ids).challengeId, null);
  });

  test('un reto cancelado no tiene ganador ni admite partidas', () => {
    const ch = cancelChallenge(primero(1), local('2026-10-20', '20:00'));
    const p = challengeProgress(ch, [play(ch, 0, local('2026-10-20', '20:30'))], local('2026-10-20', '21:00'));
    assert.equal(p.state, 'cancelado');
    assert.deepEqual(p.winnerIds, []);
    assert.equal(p.accepting, false);
  });
});

describe('retos: serie por período', () => {
  test('cuenta el día en que termina cada partida, en la zona horaria del reto, con ambos días incluidos', () => {
    const ch = serie();
    const games = [
      play(ch, 0, local('2026-10-23', '23:59')), // viernes: antes del inicio
      play(ch, 0, local('2026-10-24', '00:00')), // sábado 00:00 (UTC: 04:00): cuenta
      play(ch, 1, local('2026-10-25', '23:59')), // domingo 23:59 (UTC: lunes 03:59): cuenta
      play(ch, 1, local('2026-10-26', '00:01')), // lunes: después del cierre
    ];
    const p = challengeProgress(ch, games, local('2026-10-25', '12:00'));
    assert.deepEqual(
      p.games.map((x) => x.verdict),
      ['fuera-de-periodo', 'cuenta', 'cuenta', 'fuera-de-periodo'],
    );
    assert.equal(p.state, 'activo');
  });

  test('antes del inicio está programado; al cierre declara ganador o empate', () => {
    const ch = serie();
    assert.equal(challengeProgress(ch, [], local('2026-10-23', '23:00')).state, 'programado');
    assert.match(cannotStart(ch, challengeProgress(ch, [], local('2026-10-23', '23:00')))!, /empieza el 2026-10-24/);
    const games = [play(ch, 0, local('2026-10-24', '20:00')), play(ch, 1, local('2026-10-24', '21:00'), 100, 40)];
    const closed = challengeProgress(ch, games, local('2026-10-26', '08:00'));
    assert.equal(closed.state, 'cerrado');
    assert.equal(closed.decided, true);
    assert.equal(closed.tie, true, 'empate permitido por defecto');
    assert.equal(closed.winnerIds.length, 2);
    // Con desempate por puntos gana quien sumó más en las partidas del reto (Beto: 100; Ana: 100 + 40).
    const byPoints = serie('puntos');
    const games2 = [play(byPoints, 0, local('2026-10-24', '20:00')), play(byPoints, 1, local('2026-10-24', '21:00'), 100, 40)];
    const r = challengeProgress(byPoints, games2, local('2026-10-26', '08:00'));
    assert.equal(r.tie, false);
    assert.deepEqual(r.winnerIds, [byPoints.entrants[0].id]);
  });

  test('una serie sin partidas al cierre termina empatada a cero', () => {
    const ch = serie();
    const p = challengeProgress(ch, [], local('2026-10-27', '08:00'));
    assert.equal(p.state, 'cerrado');
    assert.equal(p.tie, true);
  });
});
