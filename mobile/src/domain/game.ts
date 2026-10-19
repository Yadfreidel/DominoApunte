// Reglas de la partida. Código puro (sin React Native) para poder probarlo con Node.
// Las mismas reglas se aplican en el servidor: server/src/domain.js.

export type Mode = 'individual' | 'parejas';
export type GameStatus = 'pendiente' | 'terminada' | 'cancelada';

export interface Participant {
  /** Identificador dentro de la partida. */
  id: string;
  name: string;
  /** Identificador estable de la persona (registro de jugadores); el mismo en todas sus partidas. */
  playerId?: string;
}

/** Un lado es quien suma puntos: un jugador (individual) o un equipo (parejas). */
export interface Side {
  id: string;
  name: string;
  participantIds: string[];
  /** En partidas de torneo: participante del cuadro (jugador o pareja) al que representa este lado. */
  entrantId?: string;
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
  /** Partida de práctica: se guarda pero no cuenta para estadísticas ni historial entre rivales. */
  practice?: boolean;
  /** Participante que sale (sorteado o elegido); null si no se definió. */
  starterParticipantId?: string | null;
  /** Partida de un torneo: torneo y enfrentamiento del cuadro. */
  tournamentId?: string | null;
  matchId?: string | null;
  /**
   * Reglas opcionales elegidas al crear la partida. Se copian: cambiar los valores predeterminados
   * del organizador no modifica partidas existentes ni en curso.
   */
  rules?: GameRules | null;
}

export interface GameRules {
  /** Puntos que se anotan al rival cuando un jugador pasa (0 = sin penalización). */
  passPoints: number;
}

/**
 * Configuración de una partida nueva.
 * - Individual: `names` tiene un nombre por jugador (se usan los primeros `playerCount`).
 * - Parejas: `names` es [pareja 1 jugador A, pareja 1 jugador B, pareja 2 jugador A, pareja 2 jugador B];
 *   cada pareja necesita dos jugadores distintos.
 */
export interface GameSetup {
  playerCount: number;
  names: string[];
  mode: Mode;
  target: number;
  /** Nombres editables de los equipos; si faltan, se forman con los nombres de la pareja. */
  teamNames?: [string, string];
  /** Identificadores de jugador alineados con `names` (registro de jugadores). */
  playerIds?: (string | undefined)[];
  practice?: boolean;
  /** Índice en `names` del jugador que sale, si se sorteó o eligió. */
  starterIndex?: number | null;
  /** Partida de torneo: torneo, enfrentamiento y participante del cuadro de cada lado. */
  tournament?: { tournamentId: string; matchId: string; entrantIds: string[] };
  rules?: GameRules | null;
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

/** Nombres de cada pareja: [[jugador A, jugador B], [jugador A, jugador B]] (sin vacíos). */
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
    const incomplete = pairs.findIndex((p) => p.length < 2);
    if (incomplete >= 0) return `La pareja ${incomplete + 1} necesita dos jugadores.`;
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
  if (new Set(clean.map(nameKey)).size !== clean.length) return 'Un jugador no puede estar dos veces en la misma partida.';
  const ids = (setup.playerIds ?? []).slice(0, mode === 'parejas' ? 4 : playerCount).filter(Boolean);
  if (new Set(ids).size !== ids.length) return 'Un jugador no puede estar dos veces en la misma partida.';
  const pass = setup.rules?.passPoints ?? 0;
  if (!Number.isInteger(pass) || pass < 0 || pass > MAX_HAND_POINTS) return `Los puntos por pase deben estar entre 0 y ${MAX_HAND_POINTS}.`;
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
  const playerIdAt = (i: number) => setup.playerIds?.[i] || undefined;
  if (setup.mode === 'parejas') {
    const teams = setup.teamNames?.map(normalizeName) ?? ['', ''];
    participants = [];
    sides = [0, 1].map((team) => {
      const members = [team * 2, team * 2 + 1].map((i) => {
        const p: Participant = { id: makeId(), name: normalizeName(setup.names[i]) };
        const pid = playerIdAt(i);
        if (pid) p.playerId = pid;
        participants.push(p);
        return p;
      });
      return {
        id: makeId(),
        name: teams[team] || coupleName(members.map((m) => m.name)),
        participantIds: members.map((m) => m.id),
      };
    });
  } else {
    participants = setup.names.slice(0, setup.playerCount).map((name, i) => {
      const p: Participant = { id: makeId(), name: normalizeName(name) };
      const pid = playerIdAt(i);
      if (pid) p.playerId = pid;
      return p;
    });
    sides = participants.map((p) => ({ id: makeId(), name: p.name, participantIds: [p.id] }));
  }
  if (setup.tournament) {
    const entrantIds = setup.tournament.entrantIds;
    sides.forEach((side, i) => {
      side.entrantId = entrantIds[i];
    });
  }
  const starter =
    setup.starterIndex != null && setup.starterIndex >= 0 && setup.starterIndex < participants.length
      ? participants[setup.starterIndex].id
      : null;
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
    practice: !!setup.practice,
    starterParticipantId: starter,
    tournamentId: setup.tournament?.tournamentId ?? null,
    matchId: setup.tournament?.matchId ?? null,
    rules: setup.rules ? { passPoints: setup.rules.passPoints } : null,
  };
}

/** La partida cuenta para estadísticas e historial entre rivales: terminada, con ganador y no de práctica. */
export function isCountable(game: Game): boolean {
  return game.status === 'terminada' && !!game.winnerSideId && !game.practice;
}

/**
 * Duración real de la partida en milisegundos (desde que se creó hasta que terminó), o null si
 * faltan datos o no son coherentes. Nunca se estima.
 */
export function gameDurationMs(game: Pick<Game, 'createdAt' | 'finishedAt' | 'status'>): number | null {
  if (game.status !== 'terminada' || !game.finishedAt) return null;
  const start = Date.parse(game.createdAt);
  const end = Date.parse(game.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return end - start;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
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
    participants: game.participants.map((p) => ({
      id: participantMap.get(p.id)!,
      name: p.name,
      ...(p.playerId ? { playerId: p.playerId } : {}),
    })),
    sides: game.sides.map((s) => ({
      id: makeId(),
      name: s.name,
      participantIds: s.participantIds.map((id) => participantMap.get(id)!),
    })),
    hands: [],
    winnerSideId: null,
    rematchOf: game.id,
    revision: 0,
    practice: !!game.practice,
    starterParticipantId: null,
    tournamentId: null,
    matchId: null,
    rules: game.rules ? { ...game.rules } : null,
  };
}

/** Revancha ya creada para una partida (la siguiente con los mismos participantes), si existe. */
export function findRematch(games: Game[], gameId: string): Game | undefined {
  return games.find((g) => g.rematchOf === gameId && g.status !== 'cancelada');
}

export interface VictorySummary {
  gameId: string;
  winnerSideId: string;
  winnerIndex: number;
  /** «¡Juan y Pedro ganaron!» o «¡Juan ganó!» */
  headline: string;
  /** Integrantes cuando la pareja tiene un nombre propio (p. ej. «Juan y Pedro»). */
  members: string | null;
  /** «215 puntos · ¡Se pasaron por 15 puntos!» o «¡Meta exacta: 200 puntos!» */
  detail: string;
  points: number;
  target: number;
  /** Puntos por encima de la meta (0 si llegó exacto). */
  over: number;
  exact: boolean;
  scores: { sideId: string; name: string; points: number; winner: boolean }[];
}

/**
 * Resumen de la victoria para la celebración. Es una copia: sigue mostrando el resultado final
 * aunque después se empiece la siguiente partida con el marcador en cero.
 */
export function victorySummary(game: Game): VictorySummary | null {
  if (game.status !== 'terminada' || !game.winnerSideId) return null;
  const t = totals(game);
  const winnerIndex = game.sides.findIndex((sd) => sd.id === game.winnerSideId);
  const winner = game.sides[winnerIndex];
  if (!winner) return null;
  const members = sideLabel(game, winner);
  const plural = winner.participantIds.length > 1;
  const points = t[winner.id] ?? 0;
  const over = Math.max(0, points - game.target);
  const exact = over === 0;
  const unit = (n: number) => (n === 1 ? 'punto' : 'puntos');
  return {
    gameId: game.id,
    winnerSideId: winner.id,
    winnerIndex,
    headline: `¡${winner.name} ${plural ? 'ganaron' : 'ganó'}!`,
    members: plural && members !== winner.name ? members : null,
    detail: exact
      ? `¡Meta exacta: ${game.target} ${unit(game.target)}!`
      : `${points} ${unit(points)} · ¡Se ${plural ? 'pasaron' : 'pasó'} por ${over} ${unit(over)}!`,
    points,
    target: game.target,
    over,
    exact,
    scores: game.sides.map((sd) => ({ sideId: sd.id, name: sd.name, points: t[sd.id] ?? 0, winner: sd.id === winner.id })),
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
