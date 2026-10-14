// Reglas de partida del lado del servidor. Deben coincidir con mobile/src/domain/game.ts.

export const MAX_HAND_POINTS = 1000;
export const MAX_TARGET = 10000;

/**
 * Recalcula estado y ganador a partir de las manos en orden cronológico.
 * Gana el primer lado que alcanza o supera la meta.
 */
export function recompute(game, hands, now) {
  const totals = Object.fromEntries(game.sides.map((s) => [s.id, 0]));
  let winner = null;
  for (const hand of hands) {
    if (!(hand.sideId in totals)) continue;
    totals[hand.sideId] += hand.points;
    if (!winner && totals[hand.sideId] >= game.target) winner = hand.sideId;
  }
  if (game.status === 'cancelada') {
    return { ...game, totals, winnerSideId: null };
  }
  if (winner) {
    return {
      ...game,
      totals,
      status: 'terminada',
      winnerSideId: winner,
      finishedAt: game.status === 'terminada' && game.finishedAt ? game.finishedAt : now,
    };
  }
  return { ...game, totals, status: 'pendiente', winnerSideId: null, finishedAt: null };
}

export function isNonNegativeInt(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}
