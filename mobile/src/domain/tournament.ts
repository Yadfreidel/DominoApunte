// Torneos de eliminación directa.
//
// El torneo guarda solo su estructura: participantes del cuadro y cruces de la primera ronda
// (con los pases automáticos ya sorteados). Todo lo demás —quién avanza, el estado de cada
// enfrentamiento y el campeón— se calcula a partir de las partidas vinculadas. Así la única
// fuente de verdad son las partidas: registrar o corregir una mano actualiza el cuadro, el
// historial y las estadísticas a la vez, sin escrituras adicionales que puedan quedar a medias.
import type { Game, GameSetup, Mode } from './game.ts';
import { MAX_NAME_LENGTH, MAX_TARGET, nameKey, newId, normalizeName } from './game.ts';
import { shuffle, type Rng } from './draw.ts';

export interface EntrantPlayer {
  playerId: string;
  name: string;
}

/** Participante del cuadro: un jugador (individual) o una pareja fija durante todo el torneo. */
export interface Entrant {
  id: string;
  name: string;
  players: EntrantPlayer[];
}

export interface BracketMatch {
  id: string;
  round: number;
  index: number;
  /** Solo en la primera ronda: ids de participantes; null es un pase automático. */
  slots?: [string | null, string | null];
}

export interface Tournament {
  id: string;
  name: string;
  mode: Mode;
  target: number;
  entrants: Entrant[];
  rounds: BracketMatch[][];
  createdAt: string;
  updatedAt: string;
  /** En pausa (desde el panel): no se pueden empezar enfrentamientos nuevos. */
  status: 'activo' | 'pausado' | 'cancelado';
  revision: number;
  /** Revisión de la última corrección administrativa incorporada (0 = ninguna). */
  adminRevision?: number;
  /** Cuenta con la que se creó en este dispositivo (solo local): evita subirlo con otra cuenta. */
  accountId?: number | null;
}

export interface TournamentInput {
  name: string;
  mode: Mode;
  target: number;
  entrants: { name?: string; players: EntrantPlayer[] }[];
}

export const MIN_ENTRANTS = 2;
export const MAX_ENTRANTS = 64;

export class TournamentError extends Error {}

export function validateTournamentInput(input: TournamentInput): string | null {
  const name = normalizeName(input.name ?? '');
  if (!name) return 'Escribe el nombre del torneo.';
  if (name.length > 40) return 'El nombre del torneo no puede superar 40 caracteres.';
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > MAX_TARGET) return 'Elige una meta válida.';
  const n = input.entrants.length;
  const unit = input.mode === 'parejas' ? 'parejas' : 'jugadores';
  if (n < MIN_ENTRANTS) return `Se necesitan al menos ${MIN_ENTRANTS} ${unit}.`;
  if (n > MAX_ENTRANTS) return `El máximo es ${MAX_ENTRANTS} ${unit}.`;
  const size = input.mode === 'parejas' ? 2 : 1;
  const seen = new Set<string>();
  const teamNames = new Set<string>();
  for (const [i, e] of input.entrants.entries()) {
    if (e.players.length !== size) {
      return input.mode === 'parejas' ? `La pareja ${i + 1} necesita dos jugadores.` : 'Cada participante es un jugador.';
    }
    for (const p of e.players) {
      if (!p.playerId || !normalizeName(p.name)) return 'Hay un jugador sin nombre.';
      if (seen.has(p.playerId)) return `${p.name} aparece más de una vez en el torneo.`;
      seen.add(p.playerId);
    }
    if (input.mode === 'parejas') {
      const label = normalizeName(e.name ?? '') || e.players.map((p) => p.name).join(' y ');
      if (label.length > MAX_NAME_LENGTH * 2) return 'El nombre de una pareja es demasiado largo.';
      if (teamNames.has(nameKey(label))) return `Hay dos parejas con el nombre "${label}".`;
      teamNames.add(nameKey(label));
    }
  }
  return null;
}

const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Crea el torneo y sortea los cruces. Si la cantidad no es potencia de dos, algunos participantes
 * reciben un pase automático en la primera ronda, repartidos por el cuadro para que nunca se
 * enfrenten dos pases.
 */
export function createTournament(input: TournamentInput, now: string, rng: Rng = Math.random, makeId: () => string = newId): Tournament {
  const error = validateTournamentInput(input);
  if (error) throw new TournamentError(error);
  const entrants: Entrant[] = input.entrants.map((e) => ({
    id: makeId(),
    name: normalizeName(e.name ?? '') || e.players.map((p) => normalizeName(p.name)).join(' y '),
    players: e.players.map((p) => ({ playerId: p.playerId, name: normalizeName(p.name) })),
  }));
  const size = nextPowerOfTwo(entrants.length);
  const firstRoundMatches = size / 2;
  const byes = size - entrants.length;
  const byeAt = new Set<number>();
  for (let k = 0; k < byes; k++) byeAt.add(Math.floor((k * firstRoundMatches) / byes));
  const order = shuffle(entrants, rng).map((e) => e.id);
  const rounds: BracketMatch[][] = [];
  const first: BracketMatch[] = [];
  let cursor = 0;
  for (let i = 0; i < firstRoundMatches; i++) {
    const a = order[cursor++];
    const b = byeAt.has(i) ? null : order[cursor++];
    first.push({ id: makeId(), round: 0, index: i, slots: [a, b] });
  }
  rounds.push(first);
  for (let r = 1, count = firstRoundMatches / 2; count >= 1; r++, count /= 2) {
    rounds.push(Array.from({ length: count }, (_, i) => ({ id: makeId(), round: r, index: i })));
  }
  return {
    id: makeId(),
    name: normalizeName(input.name),
    mode: input.mode,
    target: input.target,
    entrants,
    rounds,
    createdAt: now,
    updatedAt: now,
    status: 'activo',
    revision: 0,
  };
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Cuartos de final';
  if (fromEnd === 3) return 'Octavos de final';
  return `Ronda ${round + 1}`;
}

export type MatchState = 'esperando' | 'listo' | 'en_juego' | 'terminado' | 'pase';

export interface ResolvedMatch {
  id: string;
  round: number;
  index: number;
  roundName: string;
  a: Entrant | null;
  b: Entrant | null;
  state: MatchState;
  /** Partida vinculada (no cancelada), si ya empezó. */
  game: Game | null;
  winner: Entrant | null;
  /** Pase automático: el participante avanza sin jugar; no cuenta como victoria. */
  isBye: boolean;
}

export interface ResolvedTournament {
  tournament: Tournament;
  rounds: ResolvedMatch[][];
  champion: Entrant | null;
  status: 'en_curso' | 'terminado' | 'cancelado';
  finishedAt: string | null;
}

/** Partida vigente de un enfrentamiento: la primera no cancelada. */
export function matchGame(t: Pick<Tournament, 'id'>, matchId: string, games: Game[]): Game | null {
  const linked = games
    .filter((g) => g.tournamentId === t.id && g.matchId === matchId && g.status !== 'cancelada')
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  return linked[0] ?? null;
}

function winnerOfGame(game: Game, byId: Map<string, Entrant>): Entrant | null {
  if (game.status !== 'terminada' || !game.winnerSideId) return null;
  const side = game.sides.find((s) => s.id === game.winnerSideId);
  return side?.entrantId ? byId.get(side.entrantId) ?? null : null;
}

export function resolveTournament(t: Tournament, games: Game[]): ResolvedTournament {
  const byId = new Map(t.entrants.map((e) => [e.id, e]));
  const total = t.rounds.length;
  const rounds: ResolvedMatch[][] = [];
  for (const [r, matches] of t.rounds.entries()) {
    rounds.push(
      matches.map((m) => {
        let a: Entrant | null;
        let b: Entrant | null;
        let feedersDone = true;
        if (r === 0) {
          a = m.slots?.[0] ? byId.get(m.slots[0]) ?? null : null;
          b = m.slots?.[1] ? byId.get(m.slots[1]) ?? null : null;
        } else {
          const fa = rounds[r - 1][m.index * 2];
          const fb = rounds[r - 1][m.index * 2 + 1];
          a = fa?.winner ?? null;
          b = fb?.winner ?? null;
          feedersDone = !!a && !!b;
        }
        const isBye = r === 0 && !!a && !b;
        const game = isBye ? null : matchGame(t, m.id, games);
        let state: MatchState;
        let winner: Entrant | null = null;
        if (isBye) {
          state = 'pase';
          winner = a;
        } else if (!feedersDone || !a || !b) {
          state = 'esperando';
        } else if (!game) {
          state = 'listo';
        } else {
          winner = winnerOfGame(game, byId);
          state = winner ? 'terminado' : 'en_juego';
        }
        return { id: m.id, round: r, index: m.index, roundName: roundName(r, total), a, b, state, game, winner, isBye };
      }),
    );
  }
  const final = rounds[total - 1]?.[0];
  const champion = final?.winner ?? null;
  return {
    tournament: t,
    rounds,
    champion,
    status: t.status === 'cancelado' ? 'cancelado' : champion ? 'terminado' : 'en_curso',
    finishedAt: champion ? final?.game?.finishedAt ?? null : null,
  };
}

/** Busca el enfrentamiento y su ubicación en el cuadro. */
export function findMatch(resolved: ResolvedTournament, matchId: string): ResolvedMatch | undefined {
  for (const round of resolved.rounds) {
    const m = round.find((x) => x.id === matchId);
    if (m) return m;
  }
  return undefined;
}

/**
 * Motivo por el que no se puede modificar el resultado de una partida de torneo, o null si se puede.
 * Un resultado queda bloqueado cuando el enfrentamiento siguiente ya tiene una partida iniciada.
 */
export function lockReason(t: Tournament, games: Game[], game: Game): string | null {
  if (game.tournamentId !== t.id || !game.matchId) return null;
  const resolved = resolveTournament(t, games);
  const m = findMatch(resolved, game.matchId);
  if (!m) return null;
  const next = resolved.rounds[m.round + 1]?.[Math.floor(m.index / 2)];
  if (next?.game) {
    return `Este resultado ya no se puede cambiar: el enfrentamiento de ${next.roundName.toLowerCase()} ya empezó.`;
  }
  return null;
}

/** Configuración de la partida de un enfrentamiento listo para jugarse. */
export function matchGameSetup(t: Tournament, match: ResolvedMatch, starterIndex: number | null = null): GameSetup {
  if (t.status === 'cancelado') throw new TournamentError('El torneo está cancelado.');
  if (t.status === 'pausado') throw new TournamentError('El torneo está en pausa. El organizador debe reanudarlo para seguir jugando.');
  if (match.state !== 'listo' || !match.a || !match.b) throw new TournamentError('Este enfrentamiento todavía no se puede jugar.');
  const entrants = [match.a, match.b];
  const players = entrants.flatMap((e) => e.players);
  return {
    playerCount: players.length,
    names: players.map((p) => p.name),
    playerIds: players.map((p) => p.playerId),
    mode: t.mode,
    target: t.target,
    teamNames: t.mode === 'parejas' ? [match.a.name, match.b.name] : undefined,
    starterIndex,
    tournament: { tournamentId: t.id, matchId: match.id, entrantIds: entrants.map((e) => e.id) },
  };
}

export function cancelTournament(t: Tournament, now: string): Tournament {
  if (t.status === 'cancelado') return t;
  return { ...t, status: 'cancelado', updatedAt: now, revision: t.revision + 1 };
}
