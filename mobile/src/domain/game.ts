// Reglas de la partida. Código puro (sin React Native) para poder probarlo con Node.
// Las mismas reglas se aplican en el servidor: server/src/domain.js.

export type Mode = 'individual' | 'parejas';
export type GameStatus = 'pendiente' | 'terminada' | 'cancelada';

export interface Participant {
  id: string;
  name: string;
}

/** Un lado es quien suma puntos: un jugador (individual) o un equipo (parejas). */
export interface Side {
  id: string;
  name: string;
  participantIds: string[];
}

export interface Hand {
  id: string;
  sideId: string;
  points: number;
  createdAt: string;
  editedAt?: string | null;
}

export interface Game {
  id: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  status: GameStatus;
  mode: Mode;
  target: number;
  participants: Participant[];
  sides: Side[];
  hands: Hand[];
  winnerSideId: string | null;
  rematchOf: string | null;
  /** Aumenta con cada cambio; el servidor la usa para saber qué versión es más reciente. */
  revision: number;
  /** true cuando un administrador corrigió la partida en el servidor. */
  adminLocked?: boolean;
  /** Revisión de la última corrección administrativa incorporada en este dispositivo. */
  adminRevision?: number;
}

/**
 * Configuración de una partida nueva.
 * - Individual: `names` tiene un nombre por jugador (se usan los primeros `playerCount`).
 * - Parejas: `names` es [pareja 1, compañero 1, pareja 2, compañero 2]. Solo es obligatorio
 *   un nombre por pareja; el compañero es opcional.
 */
export interface GameSetup {
  playerCount: number;
  names: string[];
  mode: Mode;
  target: number;
  /** Nombres opcionales de los equipos; si faltan, se forman con los nombres de la pareja. */
  teamNames?: [string, string];
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 24;
export const MAX_HAND_POINTS = 1000;
export const MAX_TARGET = 10000;

export class GameError extends Error {}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('es');
}

type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/** Valida un número entero no negativo escrito por el usuario. */
export function parsePoints(text: string, max = MAX_HAND_POINTS): ParseResult {
  const value = text.trim();
  if (value === '') return { ok: false, error: 'Escribe los puntos de la mano.' };
  if (!/^\d+$/.test(value)) return { ok: false, error: 'Solo se permiten números enteros sin signo.' };
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) return { ok: false, error: `El máximo por mano es ${max}.` };
  return { ok: true, value: n };
}

export function parseTarget(text: string): ParseResult {
  const r = parsePoints(text, MAX_TARGET);
  if (!r.ok) return r.error.startsWith('El máximo') ? { ok: false, error: `La meta máxima es ${MAX_TARGET}.` } : r;
  if (r.value < 1) return { ok: false, error: 'La meta debe ser mayor que cero.' };
  return r;
}

/** Nombres de cada pareja: [[jugador, compañero?], [jugador, compañero?]]. */
export function couples(names: string[]): [string[], string[]] {
  const pair = (a = '', b = '') => [normalizeName(a), normalizeName(b)].filter(Boolean);
  return [pair(names[0], names[1]), pair(names[2], names[3])];
}

export function coupleName(members: string[]): string {
  return members.join(' y ');
}

/** Devuelve el mensaje de error de la configuración o null si es válida. */
export function validateSetup(setup: GameSetup): string | null {
  const { playerCount, names, mode, target } = setup;
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    return 'Selecciona entre 2 y 4 jugadores.';
  }
  if (mode === 'parejas' && playerCount !== 4) return 'La modalidad por parejas requiere 4 jugadores.';
  if (!Number.isInteger(target) || target < 1 || target > MAX_TARGET) return 'Elige una meta válida.';
  let clean: string[];
  if (mode === 'parejas') {
    const pairs = couples(names);
    const missing = pairs.findIndex((p) => p.length === 0);
    if (missing >= 0) return `Escribe al menos un jugador de la pareja ${missing + 1}.`;
    clean = pairs.flat();
  } else {
    clean = names.slice(0, playerCount).map(normalizeName);
    if (clean.length < playerCount) return 'Escribe el nombre de cada jugador.';
    const emptyIndex = clean.findIndex((n) => n === '');
    if (emptyIndex >= 0) return `Escribe el nombre del jugador ${emptyIndex + 1}.`;
  }
  if (clean.some((n) => n.length > MAX_NAME_LENGTH)) {
    return `Los nombres no pueden superar ${MAX_NAME_LENGTH} caracteres.`;
  }
  if (new Set(clean.map(nameKey)).size !== clean.length) return 'Hay nombres repetidos.';
  if (mode === 'parejas' && setup.teamNames) {
    const teams = setup.teamNames.map(normalizeName);
    if (teams.some((t) => t.length > MAX_NAME_LENGTH)) return 'El nombre del equipo es demasiado largo.';
    if (teams[0] && nameKey(teams[0]) === nameKey(teams[1])) return 'Los equipos deben tener nombres distintos.';
  }
  return null;
}

export function createGame(setup: GameSetup, now: string, makeId: () => string = newId): Game {
  const error = validateSetup(setup);
  if (error) throw new GameError(error);
  let participants: Participant[];
  let sides: Side[];
  if (setup.mode === 'parejas') {
    const pairs = couples(setup.names);
    const teams = setup.teamNames?.map(normalizeName) ?? ['', ''];
    participants = [];
    sides = pairs.map((members, i) => {
      const ids = members.map((name) => {
        const p = { id: makeId(), name };
        participants.push(p);
        return p.id;
      });
      return { id: makeId(), name: teams[i] || coupleName(members), participantIds: ids };
    });
  } else {
    participants = setup.names
      .slice(0, setup.playerCount)
      .map((name) => ({ id: makeId(), name: normalizeName(name) }));
    sides = participants.map((p) => ({ id: makeId(), name: p.name, participantIds: [p.id] }));
  }
  return {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    status: 'pendiente',
    mode: setup.mode,
    target: setup.target,
    participants,
    sides,
    hands: [],
    winnerSideId: null,
    rematchOf: null,
    revision: 0,
  };
}

export function totals(game: Pick<Game, 'sides' | 'hands'>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const s of game.sides) result[s.id] = 0;
  for (const h of game.hands) if (h.sideId in result) result[h.sideId] += h.points;
  return result;
}

/** Totales acumulados después de cada mano (para el historial de manos). */
export function runningTotals(game: Pick<Game, 'sides' | 'hands'>): Record<string, number>[] {
  const acc: Record<string, number> = {};
  for (const s of game.sides) acc[s.id] = 0;
  return game.hands.map((h) => {
    if (h.sideId in acc) acc[h.sideId] += h.points;
    return { ...acc };
  });
}

/** Recalcula ganador y estado. Gana el primer lado que alcanza o supera la meta (orden cronológico). */
export function recompute(game: Game, now: string): Game {
  const acc: Record<string, number> = {};
  for (const s of game.sides) acc[s.id] = 0;
  let winner: string | null = null;
  for (const h of game.hands) {
    if (!(h.sideId in acc)) continue;
    acc[h.sideId] += h.points;
    if (!winner && acc[h.sideId] >= game.target) winner = h.sideId;
  }
  if (game.status === 'cancelada') return { ...game, winnerSideId: null };
  if (winner) {
    return {
      ...game,
      status: 'terminada',
      winnerSideId: winner,
      finishedAt: game.status === 'terminada' && game.finishedAt ? game.finishedAt : now,
    };
  }
  return { ...game, status: 'pendiente', winnerSideId: null, finishedAt: null };
}

function touch(game: Game, now: string): Game {
  return recompute({ ...game, updatedAt: now, revision: game.revision + 1 }, now);
}

function assertEditable(game: Game) {
  if (game.status === 'cancelada') throw new GameError('La partida está cancelada.');
}

/**
 * Registra una mano. Es idempotente: si ya existe una mano con ese id (doble pulsación,
 * reintento) devuelve la partida sin cambios.
 */
export function addHand(game: Game, sideId: string, points: number, handId: string, now: string): Game {
  if (game.hands.some((h) => h.id === handId)) return game;
  assertEditable(game);
  if (game.status === 'terminada') throw new GameError('La partida ya terminó.');
  if (!game.sides.some((s) => s.id === sideId)) throw new GameError('Jugador o equipo desconocido.');
  if (!Number.isInteger(points) || points < 0 || points > MAX_HAND_POINTS) {
    throw new GameError('Los puntos deben ser un número entero no negativo.');
  }
  return touch({ ...game, hands: [...game.hands, { id: handId, sideId, points, createdAt: now }] }, now);
}

export function editHand(
  game: Game,
  handId: string,
  changes: { points?: number; sideId?: string },
  now: string,
): Game {
  assertEditable(game);
  const hand = game.hands.find((h) => h.id === handId);
  if (!hand) throw new GameError('La mano no existe.');
  const points = changes.points ?? hand.points;
  const sideId = changes.sideId ?? hand.sideId;
  if (!Number.isInteger(points) || points < 0 || points > MAX_HAND_POINTS) {
    throw new GameError('Los puntos deben ser un número entero no negativo.');
  }
  if (!game.sides.some((s) => s.id === sideId)) throw new GameError('Jugador o equipo desconocido.');
  if (points === hand.points && sideId === hand.sideId) return game;
  return touch(
    { ...game, hands: game.hands.map((h) => (h.id === handId ? { ...h, points, sideId, editedAt: now } : h)) },
    now,
  );
}

/** Elimina cualquier mano (no solo la última) y recalcula marcador y ganador. */
export function removeHand(game: Game, handId: string, now: string): Game {
  assertEditable(game);
  if (!game.hands.some((h) => h.id === handId)) throw new GameError('La mano no existe.');
  return touch({ ...game, hands: game.hands.filter((h) => h.id !== handId) }, now);
}

export function undoLastHand(game: Game, now: string): Game {
  assertEditable(game);
  if (game.hands.length === 0) throw new GameError('No hay manos para deshacer.');
  return touch({ ...game, hands: game.hands.slice(0, -1) }, now);
}

export function cancelGame(game: Game, now: string): Game {
  if (game.status !== 'pendiente') throw new GameError('Solo se pueden cancelar partidas pendientes.');
  return { ...game, status: 'cancelada', winnerSideId: null, updatedAt: now, revision: game.revision + 1 };
}

/** Nueva partida con los mismos participantes, modalidad y meta; marcadores en cero. */
export function createRematch(game: Game, now: string, makeId: () => string = newId): Game {
  const participantMap = new Map(game.participants.map((p) => [p.id, makeId()]));
  return {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    status: 'pendiente',
    mode: game.mode,
    target: game.target,
    participants: game.participants.map((p) => ({ id: participantMap.get(p.id)!, name: p.name })),
    sides: game.sides.map((s) => ({
      id: makeId(),
      name: s.name,
      participantIds: s.participantIds.map((id) => participantMap.get(id)!),
    })),
    hands: [],
    winnerSideId: null,
    rematchOf: game.id,
    revision: 0,
  };
}

export function sideLabel(game: Game, side: Side): string {
  if (game.mode !== 'parejas') return side.name;
  const names = side.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name ?? '?');
  return names.join(' y ');
}

export function participantSide(game: Game, participantId: string): Side | undefined {
  return game.sides.find((s) => s.participantIds.includes(participantId));
}

// ---------- Historial y estadísticas ----------

export interface HistoryFilter {
  /** AAAA-MM-DD, inclusive */
  from?: string;
  to?: string;
  player?: string;
  status?: GameStatus | 'todas';
}

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function filterGames(games: Game[], filter: HistoryFilter): Game[] {
  const player = filter.player ? nameKey(filter.player) : '';
  return games
    .filter((g) => {
      const day = localDateKey(g.createdAt);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
      if (filter.status && filter.status !== 'todas' && g.status !== filter.status) return false;
      if (player && !g.participants.some((p) => nameKey(p.name).includes(player))) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface PlayerStats {
  key: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  pending: number;
  cancelled: number;
  points: number;
  winRate: number;
}

export function computeStats(games: Game[]): PlayerStats[] {
  const map = new Map<string, PlayerStats>();
  for (const g of games) {
    const t = totals(g);
    for (const p of g.participants) {
      const key = nameKey(p.name);
      let s = map.get(key);
      if (!s) {
        s = { key, name: p.name, played: 0, wins: 0, losses: 0, pending: 0, cancelled: 0, points: 0, winRate: 0 };
        map.set(key, s);
      }
      const side = participantSide(g, p.id);
      s.played += 1;
      if (side) s.points += t[side.id] ?? 0;
      if (g.status === 'terminada') {
        if (side && g.winnerSideId === side.id) s.wins += 1;
        else s.losses += 1;
      } else if (g.status === 'pendiente') s.pending += 1;
      else s.cancelled += 1;
    }
  }
  const list = [...map.values()];
  for (const s of list) {
    const decided = s.wins + s.losses;
    s.winRate = decided ? Math.round((s.wins / decided) * 1000) / 10 : 0;
  }
  return list.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.name.localeCompare(b.name, 'es'));
}
