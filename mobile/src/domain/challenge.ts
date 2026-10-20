// Retos entre amigos. Código puro (sin React Native) para poder probarlo con Node.
// El progreso de un reto no se guarda: se deriva de las partidas asociadas (las mismas del historial),
// con el ganador que ya calculan las reglas de la partida (game.ts). Así una corrección de una mano
// recalcula el reto sin un segundo motor de puntos.
//
// Modalidades:
// - «primero»: gana el primero que consigue N victorias. Las victorias se cuentan en el orden en que
//   terminaron las partidas; al llegar a N el reto queda decidido y no admite partidas nuevas.
// - «serie»: serie por período (fechas de inicio y cierre, ambas incluidas) en la zona horaria del
//   reto. Cuenta cada partida según el día en que TERMINÓ. Gana quien tenga más victorias al cierre;
//   el empate se resuelve según `tiePolicy` (por defecto se permite el empate).
//
// Una partida pertenece a un reto como máximo (game.challengeId, fijado al crearla) y cuenta una sola
// vez: el progreso se calcula por id de partida. No cuentan partidas canceladas, pendientes, de
// práctica, fuera del período, posteriores a la decisión ni incompatibles con el reto.
import type { Game, GameRules, GameSetup, Mode } from './game.ts';
import { isCountable, MAX_NAME_LENGTH, nameKey, newId, normalizeName, totals } from './game.ts';

export type ChallengeKind = 'primero' | 'serie';
/** empate: se permite el empate al cierre. puntos: desempata la suma de puntos en las partidas del reto. */
export type TiePolicy = 'empate' | 'puntos';
export type ChallengeStatus = 'activo' | 'cancelado';

export interface ChallengeEntrant {
  id: string;
  /** Jugador (individual) o pareja («Juan y Pedro» o nombre del equipo). */
  name: string;
  players: { name: string; playerId?: string }[];
}

export interface ChallengeLogEntry {
  at: string;
  text: string;
}

export interface Challenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  mode: Mode;
  entrants: ChallengeEntrant[];
  /** Reglas de cada partida del reto (las mismas opciones de una partida normal). */
  target: number;
  rules: GameRules | null;
  /** «primero»: victorias necesarias. */
  winsNeeded: number | null;
  /** «serie»: AAAA-MM-DD, ambos días incluidos. */
  startsOn: string | null;
  endsOn: string | null;
  timeZone: string;
  tiePolicy: TiePolicy;
  status: ChallengeStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Cuenta que creó el reto en este dispositivo (null: sin sesión). Solo local. */
  accountId?: number | null;
  /** Resultado declarado la última vez (para detectar correcciones que cambian el ganador). */
  declared: { winnerIds: string[]; tie: boolean; at: string } | null;
  /** Trazabilidad: creación, decisiones, correcciones, reaperturas y cancelación. */
  log: ChallengeLogEntry[];
}

export interface ChallengeInput {
  name: string;
  kind: ChallengeKind;
  mode: Mode;
  /** Individual: un nombre por jugador. Parejas: [A1, A2, B1, B2]. */
  names: string[];
  playerIds?: (string | undefined)[];
  teamNames?: [string, string];
  target: number;
  rules?: GameRules | null;
  winsNeeded?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  timeZone: string;
  tiePolicy?: TiePolicy;
}

export class ChallengeError extends Error {}

export const MAX_WINS_NEEDED = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Día (AAAA-MM-DD) de un instante en una zona horaria. */
export function localDay(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function validDay(day: string | null | undefined): day is string {
  if (!day || !DAY_RE.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function validateChallengeInput(input: ChallengeInput): string | null {
  const name = normalizeName(input.name ?? '');
  if (!name) return 'Escribe el nombre del reto.';
  if (name.length > 40) return 'El nombre del reto no puede superar 40 caracteres.';
  if (input.kind !== 'primero' && input.kind !== 'serie') return 'Elige la modalidad del reto.';
  if (input.mode !== 'individual' && input.mode !== 'parejas') return 'Elige jugadores individuales o parejas.';
  const names = input.names.map(normalizeName);
  if (input.mode === 'parejas') {
    if (names.length !== 4 || names.some((n) => !n)) return 'Cada pareja necesita dos jugadores.';
  } else if (names.length < 2 || names.length > 4 || names.some((n) => !n)) {
    return 'El reto necesita entre 2 y 4 jugadores con nombre.';
  }
  if (names.some((n) => n.length > MAX_NAME_LENGTH)) return `Los nombres no pueden superar ${MAX_NAME_LENGTH} caracteres.`;
  if (new Set(names.map(nameKey)).size !== names.length) return 'Un jugador no puede estar dos veces en el reto.';
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > 10000) return 'Elige una meta válida.';
  const pass = input.rules?.passPoints ?? 0;
  if (!Number.isInteger(pass) || pass < 0 || pass > 1000) return 'Los puntos por pase deben estar entre 0 y 1000.';
  if (!isValidTimeZone(input.timeZone)) return 'Zona horaria inválida.';
  if (input.kind === 'primero') {
    const n = input.winsNeeded;
    if (!Number.isInteger(n) || n! < 1 || n! > MAX_WINS_NEEDED) return `Las victorias necesarias deben estar entre 1 y ${MAX_WINS_NEEDED}.`;
  } else {
    if (!validDay(input.startsOn) || !validDay(input.endsOn)) return 'Escribe las fechas de inicio y cierre (AAAA-MM-DD).';
    if (input.endsOn! < input.startsOn!) return 'La fecha de cierre debe ser igual o posterior a la de inicio.';
  }
  if (input.tiePolicy && input.tiePolicy !== 'empate' && input.tiePolicy !== 'puntos') return 'Regla de empate inválida.';
  return null;
}

export function createChallenge(input: ChallengeInput, now: string, makeId: () => string = newId): Challenge {
  const problem = validateChallengeInput(input);
  if (problem) throw new ChallengeError(problem);
  const names = input.names.map(normalizeName);
  const ids = input.playerIds ?? [];
  const player = (i: number) => (ids[i] ? { name: names[i], playerId: ids[i] } : { name: names[i] });
  const entrants: ChallengeEntrant[] =
    input.mode === 'parejas'
      ? [0, 1].map((t) => {
          const players = [player(t * 2), player(t * 2 + 1)];
          const team = normalizeName(input.teamNames?.[t] ?? '');
          return { id: makeId(), name: team || players.map((p) => p.name).join(' y '), players };
        })
      : names.map((_, i) => ({ id: makeId(), name: names[i], players: [player(i)] }));
  const ch: Challenge = {
    id: makeId(),
    name: normalizeName(input.name),
    kind: input.kind,
    mode: input.mode,
    entrants,
    target: input.target,
    rules: input.rules ? { passPoints: input.rules.passPoints } : null,
    winsNeeded: input.kind === 'primero' ? input.winsNeeded! : null,
    startsOn: input.kind === 'serie' ? input.startsOn! : null,
    endsOn: input.kind === 'serie' ? input.endsOn! : null,
    timeZone: input.timeZone,
    tiePolicy: input.tiePolicy ?? 'empate',
    status: 'activo',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    declared: null,
    log: [],
  };
  ch.log = [{ at: now, text: `Reto creado: ${challengeRulesText(ch).join(' ')}` }];
  return ch;
}

/** Reglas del reto en frases (para mostrarlas antes de crearlo y en su pantalla). */
export function challengeRulesText(ch: Pick<Challenge, 'kind' | 'winsNeeded' | 'startsOn' | 'endsOn' | 'timeZone' | 'tiePolicy' | 'target' | 'rules'>): string[] {
  const out: string[] = [];
  if (ch.kind === 'primero') {
    const n = ch.winsNeeded ?? 0;
    out.push(`Gana quien consiga primero ${n} ${n === 1 ? 'victoria' : 'victorias'}; al lograrlo el reto se cierra.`);
  } else {
    out.push(
      `Serie del ${ch.startsOn} al ${ch.endsOn} (ambos días incluidos, hora de ${ch.timeZone}). Cuenta el día en que termina cada partida.`,
    );
    out.push(
      ch.tiePolicy === 'puntos'
        ? 'Si hay empate en victorias, gana quien sumó más puntos en las partidas del reto; si siguen iguales, queda en empate.'
        : 'Si hay empate en victorias al cierre, el reto termina en empate.',
    );
  }
  out.push(`Cada partida a ${ch.target} puntos${ch.rules?.passPoints ? `, pase: ${ch.rules.passPoints} puntos al rival` : ''}.`);
  out.push('Solo cuentan partidas terminadas y asociadas al reto antes de empezar; las canceladas o incompletas no cuentan.');
  return out;
}

/** Configuración de una partida del reto: mismos participantes y reglas, cada lado vinculado a su participante. */
export function challengeGameSetup(ch: Challenge, starterIndex: number | null = null): GameSetup {
  const players = ch.entrants.flatMap((e) => e.players);
  return {
    playerCount: players.length,
    names: players.map((p) => p.name),
    playerIds: players.map((p) => p.playerId),
    mode: ch.mode,
    target: ch.target,
    teamNames: ch.mode === 'parejas' ? [ch.entrants[0].name, ch.entrants[1].name] : undefined,
    starterIndex,
    rules: ch.rules ? { ...ch.rules } : null,
    challenge: { challengeId: ch.id, entrantIds: ch.entrants.map((e) => e.id) },
  };
}

export type GameVerdict =
  | 'cuenta'
  | 'en-curso'
  | 'cancelada'
  | 'practica'
  | 'fuera-de-periodo'
  | 'tras-decision'
  | 'incompatible';

export const VERDICT_LABEL: Record<GameVerdict, string> = {
  cuenta: 'Cuenta',
  'en-curso': 'En curso',
  cancelada: 'Cancelada: no cuenta',
  practica: 'De práctica: no cuenta',
  'fuera-de-periodo': 'Fuera del período: no cuenta',
  'tras-decision': 'Después de decidirse el reto: no cuenta',
  incompatible: 'Participantes o reglas distintos: no cuenta',
};

/** Motivo por el que una partida no es compatible con el reto, o null. */
export function incompatibility(ch: Challenge, game: Game): string | null {
  if (game.mode !== ch.mode) return 'modalidad distinta';
  if (game.target !== ch.target) return 'meta distinta';
  if ((game.rules?.passPoints ?? 0) !== (ch.rules?.passPoints ?? 0)) return 'reglas distintas';
  if (game.sides.length !== ch.entrants.length) return 'participantes distintos';
  const seen = new Set<string>();
  for (const side of game.sides) {
    const entrant = ch.entrants.find((e) => e.id === side.entrantId);
    if (!entrant || seen.has(entrant.id)) return 'participantes distintos';
    seen.add(entrant.id);
    const names = side.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name ?? '').map(nameKey).sort();
    const expected = entrant.players.map((p) => nameKey(p.name)).sort();
    if (names.join('|') !== expected.join('|')) return 'participantes distintos';
  }
  return null;
}

export type ChallengeState = 'programado' | 'activo' | 'completado' | 'cerrado' | 'cancelado';

export const CHALLENGE_STATE_LABEL: Record<ChallengeState, string> = {
  programado: 'Programado',
  activo: 'En juego',
  completado: 'Completado',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

export interface ChallengeRow {
  entrantId: string;
  name: string;
  wins: number;
  played: number;
  points: number;
}

export interface ChallengeProgress {
  state: ChallengeState;
  rows: ChallengeRow[];
  /** Ganadores (más de uno = empate). Vacío si todavía no hay resultado. */
  winnerIds: string[];
  tie: boolean;
  /** true cuando el resultado es definitivo (N victorias o período cerrado). */
  decided: boolean;
  /** Partida y fecha en que se decidió («primero»). */
  decidedBy: string | null;
  /** Se pueden empezar partidas nuevas del reto. */
  accepting: boolean;
  games: { game: Game; verdict: GameVerdict }[];
  /** Hoy (AAAA-MM-DD) en la zona del reto. */
  today: string;
}

const finishOf = (g: Game) => g.finishedAt ?? g.updatedAt;

export function challengeProgress(ch: Challenge, allGames: Game[], nowIso: string): ChallengeProgress {
  const today = localDay(nowIso, ch.timeZone);
  const rows: ChallengeRow[] = ch.entrants.map((e) => ({ entrantId: e.id, name: e.name, wins: 0, played: 0, points: 0 }));
  const row = (id: string | undefined) => rows.find((r) => r.entrantId === id);
  // Una partida cuenta una sola vez aunque aparezca repetida.
  const byId = new Map<string, Game>();
  for (const g of allGames) if (g.challengeId === ch.id) byId.set(g.id, g);
  const games = [...byId.values()].sort((a, b) => finishOf(a).localeCompare(finishOf(b)) || a.id.localeCompare(b.id));

  const verdicts = new Map<string, GameVerdict>();
  let decidedBy: string | null = null;
  let winnerIds: string[] = [];
  for (const g of games) {
    let v: GameVerdict;
    if (g.status === 'cancelada') v = 'cancelada';
    else if (g.practice) v = 'practica';
    else if (incompatibility(ch, g)) v = 'incompatible';
    else if (g.status !== 'terminada' || !isCountable(g)) v = 'en-curso';
    else if (ch.kind === 'serie') {
      const day = localDay(finishOf(g), ch.timeZone);
      v = day >= ch.startsOn! && day <= ch.endsOn! ? 'cuenta' : 'fuera-de-periodo';
    } else v = decidedBy ? 'tras-decision' : 'cuenta';
    verdicts.set(g.id, v);
    if (v !== 'cuenta') continue;
    const t = totals(g);
    for (const side of g.sides) {
      const r = row(side.entrantId);
      if (!r) continue;
      r.played++;
      r.points += t[side.id] ?? 0;
      if (side.id === g.winnerSideId) r.wins++;
    }
    if (ch.kind === 'primero' && !decidedBy) {
      const champion = rows.find((r) => r.wins >= (ch.winsNeeded ?? Infinity));
      if (champion) {
        decidedBy = g.id;
        winnerIds = [champion.entrantId];
      }
    }
  }

  let state: ChallengeState;
  let decided = false;
  let tie = false;
  if (ch.status === 'cancelado') state = 'cancelado';
  else if (ch.kind === 'primero') {
    decided = !!decidedBy;
    state = decided ? 'completado' : 'activo';
  } else if (today < ch.startsOn!) state = 'programado';
  else if (today > ch.endsOn!) {
    state = 'cerrado';
    decided = true;
  } else state = 'activo';

  if (ch.kind === 'serie') {
    const max = Math.max(...rows.map((r) => r.wins));
    let top = rows.filter((r) => r.wins === max);
    if (top.length > 1 && ch.tiePolicy === 'puntos') {
      const best = Math.max(...top.map((r) => r.points));
      top = top.filter((r) => r.points === best);
    }
    // Sin victorias no hay ganador; con todos empatados en cero, el cierre es empate.
    winnerIds = max > 0 || decided ? top.map((r) => r.entrantId) : [];
    tie = winnerIds.length > 1;
  }
  if (ch.status === 'cancelado') {
    decided = false;
    winnerIds = [];
    tie = false;
  }

  const ordered = [...rows].sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name, 'es'));
  return {
    state,
    rows: ordered,
    winnerIds,
    tie,
    decided,
    decidedBy,
    accepting: state === 'activo',
    games: games.map((g) => ({ game: g, verdict: verdicts.get(g.id)! })),
    today,
  };
}

/** Motivo por el que no se puede empezar una partida del reto ahora, o null. */
export function cannotStart(ch: Challenge, progress: ChallengeProgress): string | null {
  switch (progress.state) {
    case 'cancelado':
      return 'El reto está cancelado.';
    case 'completado':
      return 'El reto ya tiene ganador. Para seguir jugando hay que reabrirlo.';
    case 'cerrado':
      return 'El período del reto terminó.';
    case 'programado':
      return `El reto empieza el ${ch.startsOn}.`;
    default:
      return null;
  }
}

const names = (ch: Challenge, ids: string[]) => ids.map((id) => ch.entrants.find((e) => e.id === id)?.name ?? '?').join(' y ');

/**
 * Registra en el historial del reto los cambios del resultado definitivo: la primera decisión y
 * cualquier corrección posterior que cambie el ganador (o lo anule). Devuelve el mismo objeto si no
 * hay nada nuevo que registrar.
 */
export function reconcileDeclared(ch: Challenge, progress: ChallengeProgress, now: string): Challenge {
  const current = progress.decided ? { winnerIds: [...progress.winnerIds].sort(), tie: progress.tie } : null;
  const prev = ch.declared ? { winnerIds: [...ch.declared.winnerIds].sort(), tie: ch.declared.tie } : null;
  if (JSON.stringify(current) === JSON.stringify(prev)) return ch;
  let text: string;
  if (!prev && current) {
    text = current.tie ? `Terminó en empate: ${names(ch, current.winnerIds)}.` : `Ganador: ${names(ch, current.winnerIds)}.`;
  } else if (prev && current) {
    text = `Corrección: el resultado cambió de ${prev.tie ? 'empate' : names(ch, prev.winnerIds)} a ${current.tie ? `empate (${names(ch, current.winnerIds)})` : names(ch, current.winnerIds)}.`;
  } else {
    text = `Corrección: ${names(ch, prev!.winnerIds)} ya no tiene el resultado; el reto sigue en juego.`;
  }
  return {
    ...ch,
    declared: current ? { ...current, at: now } : null,
    log: [...ch.log, { at: now, text }],
    updatedAt: now,
    revision: ch.revision + 1,
  };
}

/** Reabre un reto «primero» ya decidido subiendo las victorias necesarias (acción explícita). */
export function reopenChallenge(ch: Challenge, progress: ChallengeProgress, winsNeeded: number, now: string): Challenge {
  if (ch.status === 'cancelado') throw new ChallengeError('El reto está cancelado.');
  if (ch.kind !== 'primero') throw new ChallengeError('Solo se reabren retos de «primero en ganar».');
  const best = Math.max(0, ...progress.rows.map((r) => r.wins));
  if (!Number.isInteger(winsNeeded) || winsNeeded <= best || winsNeeded > MAX_WINS_NEEDED) {
    throw new ChallengeError(`Para reabrirlo, las victorias necesarias deben ser más de ${best}.`);
  }
  return {
    ...ch,
    winsNeeded,
    declared: null,
    log: [...ch.log, { at: now, text: `Reabierto: ahora gana quien llegue a ${winsNeeded} victorias (antes ${ch.winsNeeded}).` }],
    updatedAt: now,
    revision: ch.revision + 1,
  };
}

export function cancelChallenge(ch: Challenge, now: string): Challenge {
  if (ch.status === 'cancelado') return ch;
  return {
    ...ch,
    status: 'cancelado',
    log: [...ch.log, { at: now, text: 'Reto cancelado. Sus partidas siguen en el historial.' }],
    updatedAt: now,
    revision: ch.revision + 1,
  };
}

/** Marcador del reto en una frase («2 a 1 para Juan», «empatada a 1»). Solo con dos participantes. */
export function seriesScore(ch: Challenge, progress: ChallengeProgress): string | null {
  if (ch.entrants.length !== 2) return null;
  const [a, b] = progress.rows;
  if (a.wins === b.wins) return `empatada a ${a.wins}`;
  return `${a.wins} a ${b.wins} para ${a.name}`;
}

export function isChallenge(value: unknown): value is Challenge {
  const c = value as Challenge;
  return !!c && typeof c.id === 'string' && Array.isArray(c.entrants) && (c.kind === 'primero' || c.kind === 'serie');
}
