// Torneos de eliminación directa del lado del servidor. Deben coincidir con
// mobile/src/domain/tournament.ts: el torneo guarda solo su estructura (participantes y cruces de
// la primera ronda) y el avance se deriva de las partidas vinculadas.
import { randomBytes, randomInt } from 'node:crypto';

export const MIN_ENTRANTS = 2;
export const MAX_ENTRANTS = 64;

export const newId = () => `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;

const nextPowerOfTwo = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sortea el cuadro. Si la cantidad no es potencia de dos, algunos participantes reciben un pase
 * automático en la primera ronda, repartidos para que nunca se enfrenten dos pases.
 */
export function drawBracket(entrants, makeId = newId) {
  const size = nextPowerOfTwo(entrants.length);
  const firstRoundMatches = size / 2;
  const byes = size - entrants.length;
  const byeAt = new Set();
  for (let k = 0; k < byes; k++) byeAt.add(Math.floor((k * firstRoundMatches) / byes));
  const order = shuffle(entrants.map((e) => e.id));
  const first = [];
  let cursor = 0;
  for (let i = 0; i < firstRoundMatches; i++) {
    const a = order[cursor++];
    const b = byeAt.has(i) ? null : order[cursor++];
    first.push({ id: makeId(), round: 0, index: i, slots: [a, b] });
  }
  const rounds = [first];
  for (let r = 1, count = firstRoundMatches / 2; count >= 1; r++, count /= 2) {
    rounds.push(Array.from({ length: count }, (_, i) => ({ id: makeId(), round: r, index: i })));
  }
  return rounds;
}

export function roundName(round, totalRounds) {
  const fromEnd = totalRounds - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Cuartos de final';
  if (fromEnd === 3) return 'Octavos de final';
  return `Ronda ${round + 1}`;
}

/** Id del enfrentamiento al que avanza el ganador de matchId, o null si es la final. */
export function nextMatchId(rounds, matchId) {
  for (let r = 0; r < rounds.length; r++) {
    const i = rounds[r].findIndex((m) => m.id === matchId);
    if (i >= 0) return rounds[r + 1]?.[Math.floor(i / 2)]?.id ?? null;
  }
  return null;
}

/**
 * Estado de cada enfrentamiento a partir de las partidas vinculadas (no canceladas ni en papelera).
 * `games` son partidas completas con tournamentId, matchId, status, winnerSideId y sides.
 */
export function resolveBracket(tournament, games) {
  const byId = new Map(tournament.entrants.map((e) => [e.id, e]));
  const total = tournament.rounds.length;
  const linked = games
    .filter((g) => g.tournamentId === tournament.id && g.status !== 'cancelada')
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const gameOf = (matchId) => linked.find((g) => g.matchId === matchId) ?? null;
  const rounds = [];
  for (const [r, matches] of tournament.rounds.entries()) {
    rounds.push(
      matches.map((m) => {
        let a;
        let b;
        let feedersDone = true;
        if (r === 0) {
          a = m.slots?.[0] ? byId.get(m.slots[0]) ?? null : null;
          b = m.slots?.[1] ? byId.get(m.slots[1]) ?? null : null;
        } else {
          a = rounds[r - 1][m.index * 2]?.winner ?? null;
          b = rounds[r - 1][m.index * 2 + 1]?.winner ?? null;
          feedersDone = !!a && !!b;
        }
        const isBye = r === 0 && !!a && !b;
        const game = isBye ? null : gameOf(m.id);
        let state;
        let winner = null;
        if (isBye) {
          state = 'pase';
          winner = a;
        } else if (!feedersDone || !a || !b) {
          state = 'esperando';
        } else if (!game) {
          state = 'listo';
        } else {
          const side = game.status === 'terminada' ? game.sides.find((s) => s.id === game.winnerSideId) : null;
          winner = side?.entrantId ? byId.get(side.entrantId) ?? null : null;
          state = winner ? 'terminado' : 'en_juego';
        }
        return { id: m.id, round: r, index: m.index, roundName: roundName(r, total), a, b, state, gameId: game?.id ?? null, winner, isBye };
      }),
    );
  }
  const champion = rounds[total - 1]?.[0]?.winner ?? null;
  return { rounds, champion };
}

/** Participantes que ya tienen alguna partida (no cancelada) en el torneo. */
export function startedEntrantIds(tournament, games) {
  const ids = new Set();
  for (const g of games) {
    if (g.tournamentId !== tournament.id || g.status === 'cancelada') continue;
    for (const s of g.sides) if (s.entrantId) ids.add(s.entrantId);
  }
  return ids;
}
