// Narrador de momentos clave: decide QUÉ anunciar a partir del estado real de la partida (los mismos
// totales y ganador de game.ts). Código puro para probarlo con Node; la voz está en services/narrator.ts.
//
// Reglas (verificables en tests/narrador.test.ts):
// - Inicio: al crear una partida (o la revancha) desde el marcador.
// - Cambio de líder: cuando un lado pasa a ir solo adelante y el líder anterior (el último que fue
//   solo adelante) era otro. Pasar a un empate NO es cambio de líder; la primera ventaja de la
//   partida tampoco (no había líder antes).
// - Remontada: un cambio de líder en el que el nuevo líder llegó a estar al menos
//   `comebackDeficit(meta)` puntos por detrás del primero en esta partida
//   (25 % de la meta, mínimo 15 puntos). Reemplaza al anuncio de cambio de líder.
// - Cerca de ganar: cuando un lado ENTRA en la zona de `nearThreshold(meta)` puntos de la meta
//   (10 % de la meta, mínimo 10). Se anuncia la cantidad exacta que falta, una vez por entrada.
// - Victoria: nombres y marcador final; tiene prioridad sobre todo lo demás (si la mano da la victoria,
//   no se anuncia cercanía ni cambio de líder).
// - Reto: avance de la serie y campeón del reto.
// Solo se generan anuncios para acciones hechas ahora en el marcador; nunca al cargar el historial,
// sincronizar o reconstruir el estado (quien llama decide; ver NarratorHost).
import type { Challenge, ChallengeProgress } from './challenge.ts';
import type { Game } from './game.ts';
import { runningTotals, totals } from './game.ts';
import { numberToSpanish } from './tiles.ts';

export type NarrationKind = 'inicio' | 'lider' | 'remontada' | 'cerca' | 'victoria' | 'reto';

export const NARRATION_LABEL: Record<NarrationKind, string> = {
  inicio: 'Inicio de la partida',
  lider: 'Cambio de líder',
  remontada: 'Remontadas',
  cerca: 'Cerca de ganar',
  victoria: 'Victoria',
  reto: 'Avances de retos',
};

export interface Narration {
  /** Identificador estable del evento (evita repetirlo). */
  id: string;
  kind: NarrationKind;
  text: string;
  gameId: string;
  /** Mayor número = más prioridad. La victoria interrumpe y descarta lo pendiente. */
  priority: number;
}

const PRIORITY: Record<NarrationKind, number> = { inicio: 1, cerca: 2, lider: 2, remontada: 3, reto: 4, victoria: 5 };

export const nearThreshold = (target: number) => Math.max(10, Math.round(target * 0.1));
export const comebackDeficit = (target: number) => Math.max(15, Math.round(target * 0.25));

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const isTeam = (game: Game, sideId: string) => (game.sides.find((s) => s.id === sideId)?.participantIds.length ?? 1) > 1;
const nameOf = (game: Game, sideId: string) => game.sides.find((s) => s.id === sideId)?.name ?? '';

/** Lado que va solo adelante (sin empate en el primer puesto, con puntos), o null. */
export function uniqueLeader(t: Record<string, number>): string | null {
  const entries = Object.entries(t);
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  if (max <= 0) return null;
  const top = entries.filter(([, v]) => v === max);
  return top.length === 1 ? top[0][0] : null;
}

export function startNarration(game: Game): Narration {
  return { id: `${game.id}:inicio`, kind: 'inicio', text: '¡Comienza la partida!', gameId: game.id, priority: PRIORITY.inicio };
}

/**
 * Anuncios de una mano recién registrada (`after` = `before` + una mano nueva al final).
 * Devuelve [] si no se trata de una mano nueva o si la mano terminó la partida (eso lo anuncia la victoria).
 */
export function handNarrations(before: Game, after: Game): Narration[] {
  if (after.id !== before.id || after.hands.length !== before.hands.length + 1) return [];
  const hand = after.hands[after.hands.length - 1];
  if (before.hands.some((h) => h.id === hand.id)) return [];
  if (after.status === 'terminada') return [];
  const out: Narration[] = [];

  // Último líder único antes de esta mano y el peor déficit de cada lado frente al primero.
  let lastLeader: string | null = null;
  const worstDeficit: Record<string, number> = {};
  for (const s of before.sides) worstDeficit[s.id] = 0;
  for (const t of runningTotals(before)) {
    const l = uniqueLeader(t);
    if (l) lastLeader = l;
    const max = Math.max(...Object.values(t));
    for (const s of before.sides) worstDeficit[s.id] = Math.max(worstDeficit[s.id], max - (t[s.id] ?? 0));
  }
  const now = totals(after);
  const leader = uniqueLeader(now);
  if (leader && lastLeader && leader !== lastLeader) {
    const name = nameOf(after, leader);
    const deficit = worstDeficit[leader] ?? 0;
    if (deficit >= comebackDeficit(after.target)) {
      out.push({
        id: `${after.id}:remontada:${hand.id}`,
        kind: 'remontada',
        text: `¡Remontada! ${name} ${isTeam(after, leader) ? 'pasan' : 'pasa'} al frente después de ir ${deficit} puntos abajo.`,
        gameId: after.id,
        priority: PRIORITY.remontada,
      });
    } else {
      out.push({
        id: `${after.id}:lider:${hand.id}`,
        kind: 'lider',
        text: `¡${name} ${isTeam(after, leader) ? 'toman' : 'toma'} la delantera!`,
        gameId: after.id,
        priority: PRIORITY.lider,
      });
    }
  }

  const prev = totals(before);
  const zone = nearThreshold(after.target);
  for (const s of after.sides) {
    const remainingBefore = after.target - (prev[s.id] ?? 0);
    const remaining = after.target - (now[s.id] ?? 0);
    if (remaining > 0 && remaining <= zone && remainingBefore > zone) {
      out.push({
        id: `${after.id}:cerca:${s.id}:${hand.id}`,
        kind: 'cerca',
        text: `¡${s.name} ${isTeam(after, s.id) ? 'están' : 'está'} a ${remaining} ${plural(remaining, 'punto', 'puntos')} de ganar!`,
        gameId: after.id,
        priority: PRIORITY.cerca,
      });
    }
  }
  return out;
}

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  /** true si la voz funciona sin internet (instalada en el dispositivo). */
  local: boolean;
}

/**
 * Voz en español para el narrador: primero las instaladas en el dispositivo (funcionan sin internet),
 * con la variante regional del dispositivo si existe (es-DO, es-MX…); luego cualquier español.
 * Devuelve null si no hay ninguna voz en español (entonces solo se muestran los anuncios en pantalla).
 */
export function pickSpanishVoice(voices: VoiceOption[], deviceLocale = 'es-ES'): VoiceOption | null {
  const spanish = voices.filter((v) => /^es([-_]|$)/i.test(v.lang));
  if (!spanish.length) return null;
  const region = deviceLocale.replace('_', '-').toLowerCase();
  const score = (v: VoiceOption) => (v.local ? 2 : 0) + (v.lang.replace('_', '-').toLowerCase() === region ? 1 : 0);
  return [...spanish].sort((a, b) => score(b) - score(a))[0];
}

/** Victoria con nombres y marcador final (copiado de la partida terminada, antes de cualquier reinicio). */
export function victoryNarration(game: Game): Narration | null {
  if (game.status !== 'terminada' || !game.winnerSideId) return null;
  const t = totals(game);
  const winner = game.sides.find((s) => s.id === game.winnerSideId);
  if (!winner) return null;
  const team = winner.participantIds.length > 1;
  const members = winner.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name).filter(Boolean);
  const who = team && members.length && members.join(' y ') !== winner.name ? `${winner.name}: ${members.join(' y ')}` : winner.name;
  const others = game.sides.filter((s) => s.id !== winner.id);
  const score =
    others.length === 1
      ? `${t[winner.id]} a ${t[others[0].id]}`
      : [winner, ...others].map((s) => `${s.name} ${t[s.id]}`).join(', ');
  return {
    id: `${game.id}:victoria`,
    kind: 'victoria',
    text: `¡${team ? 'Ganan' : 'Gana'} ${who}! Marcador final: ${score}.`,
    gameId: game.id,
    priority: PRIORITY.victoria,
  };
}

/**
 * Avance de un reto después de que terminó una de sus partidas (`before`/`after` = progreso antes y
 * después). Solo si la partida cuenta para el reto.
 */
export function challengeNarration(ch: Challenge, before: ChallengeProgress, after: ChallengeProgress, gameId: string): Narration | null {
  const counted = after.games.find((g) => g.game.id === gameId)?.verdict === 'cuenta';
  const wasCounted = before.games.find((g) => g.game.id === gameId)?.verdict === 'cuenta';
  if (!counted || wasCounted) return null;
  const base = { id: `${ch.id}:${gameId}:reto`, kind: 'reto' as const, gameId, priority: PRIORITY.reto };
  if (after.decided && !before.decided && after.winnerIds.length) {
    const winners = after.winnerIds.map((id) => ch.entrants.find((e) => e.id === id)).filter(Boolean);
    const many = winners.length > 1 || (winners[0]?.players.length ?? 1) > 1;
    return { ...base, text: many ? `¡Tenemos campeones del reto ${ch.name}!` : `¡Tenemos campeón del reto ${ch.name}: ${winners[0]!.name}!` };
  }
  if (ch.entrants.length === 2) {
    const [a, b] = after.rows;
    if (a.wins === b.wins) return { ...base, text: `¡La serie está empatada a ${numberToSpanish(a.wins)}!` };
    return { ...base, text: `¡La serie está ${numberToSpanish(a.wins)} a ${numberToSpanish(b.wins)} para ${a.name}!` };
  }
  const top = after.rows[0];
  return { ...base, text: `${top.name} ${plural(top.wins, 'lleva una victoria', `lleva ${numberToSpanish(top.wins)} victorias`)} en el reto.` };
}
