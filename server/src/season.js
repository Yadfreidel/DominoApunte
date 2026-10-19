// Temporadas de un grupo: estado según las fechas (en la zona horaria del grupo) y clasificación.
// Código puro, sin base de datos, para poder probarlo.
//
// Criterio de clasificación (visible en la app antes de empezar):
//   - Cada partida válida da puntos de clasificación: victoria = winPoints, derrota = lossPoints.
//     Son distintos de los puntos anotados en las manos, que solo se usan como último desempate.
//   - Desempates, en este orden: 1) puntos de clasificación, 2) victorias en las partidas entre los
//     empatados, 3) % de victorias, 4) diferencia de puntos anotados (a favor − en contra).
//   - Si persiste el empate, comparten la posición; si es la primera, hay campeones compartidos.
// Partidas válidas: terminadas, con ganador, no de práctica ni en la papelera, asociadas
// explícitamente a la temporada, empezadas dentro de sus fechas y terminadas antes del cierre
// definitivo (el día siguiente a la fecha final, en la zona horaria del grupo).

export const DEFAULT_SEASON_RULES = Object.freeze({ winPoints: 3, lossPoints: 0 });
export const TIEBREAKERS = ['puntos', 'enfrentamientos', 'porcentaje', 'diferencia'];
export const MODES = ['individual', 'parejas'];

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fecha local AAAA-MM-DD de un instante en una zona horaria. */
export function localDay(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Estado de la temporada en un momento dado:
 * - programada: todavía no empieza (se pueden cambiar sus reglas).
 * - activa: se pueden asociar partidas nuevas.
 * - cerrada: pasó la fecha final; no admite partidas nuevas, pero las que estaban en curso aún
 *   pueden terminar hasta el cierre definitivo (fin del día siguiente).
 * - finalizada: resultados definitivos.
 * - cancelada.
 */
export function seasonStatus(season, nowIso) {
  if (season.cancelledAt) return 'cancelada';
  const today = localDay(nowIso, season.timezone);
  if (today < season.startsOn) return 'programada';
  if (today <= season.endsOn) return 'activa';
  if (today <= addDays(season.endsOn, 1)) return 'cerrada';
  return 'finalizada';
}

/** ¿Se puede asociar una partida nueva (que empieza ahora) a esta temporada? Devuelve el motivo si no. */
export function associationProblem(season, game, nowIso) {
  const status = seasonStatus(season, nowIso);
  if (status !== 'activa') return status === 'programada' ? 'La temporada todavía no empezó.' : 'La temporada ya no admite partidas nuevas.';
  if (!season.modes.includes(game.mode)) return 'La modalidad de la partida no está admitida en la temporada.';
  if (season.ranking === 'parejas' && game.mode !== 'parejas') return 'La temporada clasifica por parejas: la partida debe ser por parejas.';
  const day = localDay(game.createdAt, season.timezone);
  if (!day || day < season.startsOn || day > season.endsOn) return 'La partida no empezó dentro de las fechas de la temporada.';
  if (game.practice) return 'Las partidas de práctica no cuentan para temporadas.';
  return null;
}

/** ¿Cuenta esta partida (con sus datos actuales) para la clasificación? */
export function countsForSeason(season, game) {
  if (game.status !== 'terminada' || !game.winnerSideId || game.practice || game.deletedAt) return false;
  if (game.seasonId !== season.id) return false;
  const started = localDay(game.createdAt, season.timezone);
  const finished = localDay(game.finishedAt ?? game.updatedAt, season.timezone);
  if (!started || started < season.startsOn || started > season.endsOn) return false;
  if (!finished || finished > addDays(season.endsOn, 1)) return false;
  return season.modes.includes(game.mode);
}

/**
 * Clasificación. `sidePlayers(game, side)` devuelve los perfiles [{id, name}] de un lado (identidad
 * estable del servidor; una pareja es la misma aunque cambie el orden de sus integrantes).
 */
export function computeStandings(season, games, sidePlayers) {
  const rules = { ...DEFAULT_SEASON_RULES, ...(season.rules ?? {}) };
  const valid = games.filter((g) => countsForSeason(season, g));
  const rows = new Map();
  const entriesOf = (g, side) => {
    const players = sidePlayers(g, side);
    if (!players.length) return [];
    if (season.ranking === 'parejas') {
      if (players.length !== 2) return [];
      const sorted = [...players].sort((a, b) => a.id - b.id);
      return [{ key: sorted.map((p) => p.id).join('+'), name: [...players].map((p) => p.name).sort((a, b) => a.localeCompare(b, 'es')).join(' y ') }];
    }
    return players.map((p) => ({ key: String(p.id), name: p.name }));
  };
  const perGame = [];
  for (const g of valid) {
    const totals = Object.fromEntries(g.sides.map((s) => [s.id, g.hands.filter((h) => h.sideId === s.id).reduce((n, h) => n + h.points, 0)]));
    const participants = [];
    for (const side of g.sides) {
      const won = side.id === g.winnerSideId;
      const against = Object.entries(totals)
        .filter(([id]) => id !== side.id)
        .reduce((n, [, v]) => Math.max(n, v), 0);
      for (const e of entriesOf(g, side)) {
        const r = rows.get(e.key) ?? { key: e.key, name: e.name, played: 0, wins: 0, losses: 0, points: 0, pointsFor: 0, pointsAgainst: 0 };
        r.name = e.name;
        r.played += 1;
        r.wins += won ? 1 : 0;
        r.losses += won ? 0 : 1;
        r.points += won ? rules.winPoints : rules.lossPoints;
        r.pointsFor += totals[side.id];
        r.pointsAgainst += against;
        rows.set(e.key, r);
        participants.push({ key: e.key, won });
      }
    }
    perGame.push(participants);
  }
  const list = [...rows.values()].map((r) => ({
    ...r,
    winRate: r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0,
    diff: r.pointsFor - r.pointsAgainst,
  }));
  // Victorias en partidas entre los empatados en puntos de clasificación.
  const h2h = (key, group) => {
    let wins = 0;
    for (const parts of perGame) {
      const inGroup = parts.filter((p) => group.has(p.key));
      if (inGroup.length < 2) continue;
      if (inGroup.some((p) => p.key === key && p.won)) wins += 1;
    }
    return wins;
  };
  const byPoints = new Map();
  for (const r of list) {
    if (!byPoints.has(r.points)) byPoints.set(r.points, new Set());
    byPoints.get(r.points).add(r.key);
  }
  for (const r of list) r.h2h = h2h(r.key, byPoints.get(r.points));
  const cmp = (a, b) => b.points - a.points || b.h2h - a.h2h || b.winRate - a.winRate || b.diff - a.diff;
  list.sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'es'));
  let position = 0;
  list.forEach((r, i) => {
    if (i === 0 || cmp(list[i - 1], r) !== 0) position = i + 1;
    r.position = position;
  });
  list.forEach((r) => {
    r.tied = list.some((o) => o !== r && o.position === r.position);
  });
  const champions = list.filter((r) => r.position === 1 && r.played > 0).map((r) => ({ key: r.key, name: r.name }));
  return { rows: list, champions, games: valid.length, rules, tiebreakers: TIEBREAKERS };
}

/** Valida los datos de una temporada nueva. Devuelve { season } normalizada o lanza un Error con mensaje. */
export function validateSeasonInput(body, group) {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 40) throw new Error('El nombre de la temporada es obligatorio (máximo 40 caracteres).');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(body?.startsOn ?? '') || !day.test(body?.endsOn ?? '')) throw new Error('Indica las fechas de inicio y cierre.');
  if (body.endsOn < body.startsOn) throw new Error('La fecha de cierre debe ser igual o posterior a la de inicio.');
  const timezone = body.timezone ?? group.timezone;
  if (!isValidTimeZone(timezone)) throw new Error('Zona horaria inválida.');
  const ranking = body.ranking;
  if (!MODES.includes(ranking)) throw new Error('Elige la clasificación: individual o por parejas.');
  let modes = Array.isArray(body.modes) ? [...new Set(body.modes)].filter((m) => MODES.includes(m)) : [];
  if (ranking === 'parejas') modes = ['parejas'];
  if (!modes.length) throw new Error('Elige al menos una modalidad.');
  const winPoints = body.rules?.winPoints ?? DEFAULT_SEASON_RULES.winPoints;
  const lossPoints = body.rules?.lossPoints ?? DEFAULT_SEASON_RULES.lossPoints;
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 100;
  if (!ok(winPoints) || !ok(lossPoints) || winPoints <= lossPoints) {
    throw new Error('Los puntos por victoria deben ser mayores que los de derrota (enteros de 0 a 100).');
  }
  return { name, startsOn: body.startsOn, endsOn: body.endsOn, timezone, ranking, modes, rules: { winPoints, lossPoints } };
}
