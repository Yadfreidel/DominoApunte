// Estadísticas personales e historial entre rivales.
// Se calculan solo con partidas válidas (terminadas, con ganador y no de práctica). Las canceladas,
// las pendientes y los pases automáticos de torneo no cuentan (un pase no genera partida).
import type { Game, Mode, Side } from './game.ts';
import { isCountable, nameKey, totals } from './game.ts';
import type { PlayerRecord } from './players.ts';

export interface PersonStats {
  /** playerId, o `nombre:<clave>` para participantes antiguos sin identificador. */
  key: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  /** Porcentaje de victorias (0–100) o null si no jugó partidas válidas. */
  winRate: number | null;
  /** Promedio de puntos por partida: propios en individual, del equipo en parejas. Null sin partidas. */
  avgPoints: number | null;
  bestStreak: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const personKey = (p: { playerId?: string; name: string }) => p.playerId ?? `nombre:${nameKey(p.name)}`;

const finishedOrder = (a: Game, b: Game) =>
  (a.finishedAt ?? a.createdAt).localeCompare(b.finishedAt ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt);

/** Estadísticas por persona, separadas por modalidad. */
export function computePersonStats(games: Game[], registry: PlayerRecord[] = []): Record<Mode, PersonStats[]> {
  const valid = games.filter(isCountable).sort(finishedOrder);
  const result = {} as Record<Mode, PersonStats[]>;
  for (const mode of ['individual', 'parejas'] as Mode[]) {
    const acc = new Map<string, { name: string; played: number; wins: number; points: number; streak: number; best: number }>();
    for (const g of valid.filter((x) => x.mode === mode)) {
      const t = totals(g);
      for (const side of g.sides) {
        const won = side.id === g.winnerSideId;
        for (const pid of side.participantIds) {
          const p = g.participants.find((x) => x.id === pid);
          if (!p) continue;
          const key = personKey(p);
          const name = (p.playerId && registry.find((r) => r.id === p.playerId)?.name) || p.name;
          const s = acc.get(key) ?? { name, played: 0, wins: 0, points: 0, streak: 0, best: 0 };
          s.name = name;
          s.played += 1;
          s.points += t[side.id] ?? 0;
          if (won) {
            s.wins += 1;
            s.streak += 1;
            s.best = Math.max(s.best, s.streak);
          } else {
            s.streak = 0;
          }
          acc.set(key, s);
        }
      }
    }
    result[mode] = [...acc.entries()]
      .map(([key, s]) => ({
        key,
        name: s.name,
        played: s.played,
        wins: s.wins,
        losses: s.played - s.wins,
        winRate: s.played ? round1((s.wins / s.played) * 100) : null,
        avgPoints: s.played ? round1(s.points / s.played) : null,
        bestStreak: s.best,
      }))
      .sort((a, b) => b.wins - a.wins || (b.winRate ?? 0) - (a.winRate ?? 0) || a.name.localeCompare(b.name, 'es'));
  }
  return result;
}

// ---------- Historial entre rivales ----------

/** Pareja identificada por sus dos integrantes, sin importar el orden ni el nombre del equipo. */
export const teamKey = (playerKeys: string[]) => [...playerKeys].sort().join('+');

function sideKey(game: Game, side: Side): string | null {
  const keys = side.participantIds.map((pid) => {
    const p = game.participants.find((x) => x.id === pid);
    return p ? personKey(p) : null;
  });
  if (keys.some((k) => k === null)) return null;
  if (game.mode === 'individual') return keys.length === 1 ? keys[0] : null;
  return keys.length === 2 ? teamKey(keys as string[]) : null;
}

export interface RivalOption {
  key: string;
  label: string;
}

/** Jugadores o parejas que aparecen en partidas válidas de la modalidad. */
export function rivalOptions(games: Game[], mode: Mode, registry: PlayerRecord[] = []): RivalOption[] {
  const map = new Map<string, string>();
  for (const g of games.filter((x) => isCountable(x) && x.mode === mode)) {
    for (const side of g.sides) {
      const key = sideKey(g, side);
      if (!key) continue;
      const names = side.participantIds.map((pid) => {
        const p = g.participants.find((x) => x.id === pid)!;
        return (p.playerId && registry.find((r) => r.id === p.playerId)?.name) || p.name;
      });
      map.set(key, names.sort((a, b) => a.localeCompare(b, 'es')).join(' y '));
    }
  }
  return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export interface Encounter {
  gameId: string;
  date: string;
  scoreA: number;
  scoreB: number;
  target: number;
  /** 'otro' cuando ganó un tercer jugador (partidas individuales de 3 o 4). */
  winner: 'a' | 'b' | 'otro';
  tournamentId: string | null;
}

export interface HeadToHead {
  encounters: Encounter[];
  winsA: number;
  winsB: number;
  others: number;
}

export function headToHead(games: Game[], mode: Mode, a: string, b: string): HeadToHead {
  const encounters: Encounter[] = [];
  if (a && b && a !== b) {
    for (const g of games.filter((x) => isCountable(x) && x.mode === mode)) {
      const sideA = g.sides.find((s) => sideKey(g, s) === a);
      const sideB = g.sides.find((s) => sideKey(g, s) === b);
      if (!sideA || !sideB || sideA.id === sideB.id) continue;
      const t = totals(g);
      encounters.push({
        gameId: g.id,
        date: g.finishedAt ?? g.createdAt,
        scoreA: t[sideA.id] ?? 0,
        scoreB: t[sideB.id] ?? 0,
        target: g.target,
        winner: g.winnerSideId === sideA.id ? 'a' : g.winnerSideId === sideB.id ? 'b' : 'otro',
        tournamentId: g.tournamentId ?? null,
      });
    }
  }
  encounters.sort((x, y) => y.date.localeCompare(x.date));
  return {
    encounters,
    winsA: encounters.filter((e) => e.winner === 'a').length,
    winsB: encounters.filter((e) => e.winner === 'b').length,
    others: encounters.filter((e) => e.winner === 'otro').length,
  };
}
