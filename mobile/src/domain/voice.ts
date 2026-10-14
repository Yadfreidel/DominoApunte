// Interpretación de órdenes por voz ("23 puntos para Juan", "Juan ganó veintitrés").
// Solo propone: nunca registra nada. Si algo es ambiguo o falta, lo dice en vez de adivinar.
import type { Game } from './game.ts';
import { MAX_HAND_POINTS } from './game.ts';

export interface VoiceProposal {
  transcript: string;
  /** Puntos reconocidos, o null si no hay un único número válido. */
  points: number | null;
  /** Todos los números encontrados (para avisar cuando hay más de uno). */
  numbers: number[];
  /** Lado elegido sin ambigüedad, o null. */
  sideId: string | null;
  /** Lados posibles cuando hay que pedir al usuario que elija. */
  candidateSideIds: string[];
  /** Avisos para el usuario (por qué hace falta corregir algo). */
  issues: string[];
  ready: boolean;
}

export function normalizeSpeech(text: string): string {
  return text
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

const isNumberWord = (w: string) => w in UNITS || w in TENS || w in HUNDREDS || w === 'mil';

/** Extrae los números (en cifras o en palabras) de un texto ya normalizado. */
export function extractNumbers(normalized: string): number[] {
  const words = normalized.split(' ').filter(Boolean);
  const found: number[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^\d+$/.test(w)) {
      found.push(Number(w));
      i++;
      continue;
    }
    if (!isNumberWord(w)) {
      i++;
      continue;
    }
    // Acumula una secuencia como "ciento treinta y cinco" o "dos mil".
    let total = 0;
    let current = 0;
    while (i < words.length) {
      const t = words[i];
      if (t === 'y' && i + 1 < words.length && (words[i + 1] in UNITS) && current % 100 >= 30) {
        i++;
        continue;
      }
      if (t in HUNDREDS) current += HUNDREDS[t];
      else if (t in TENS) current += TENS[t];
      else if (t in UNITS) current += UNITS[t];
      else if (t === 'mil') {
        total += (current || 1) * 1000;
        current = 0;
      } else break;
      i++;
    }
    found.push(total + current);
  }
  return found;
}

const COLOR_WORDS: string[][] = [
  ['verde', 'lima', 'amarillo'],
  ['morado', 'morada', 'violeta', 'purpura', 'lila'],
  ['azul', 'celeste', 'cian'],
  ['naranja', 'anaranjado'],
];
const ORDINALS: Record<string, number> = { uno: 1, primero: 1, primer: 1, dos: 2, segundo: 2, tres: 3, tercero: 3, tercer: 3, cuatro: 4, cuarto: 4 };

interface Alias {
  words: string[];
  sideIds: Set<string>;
  /** Alias genéricos ("pareja 1", "equipo verde") ceden ante un nombre propio. */
  generic: boolean;
}

function buildAliases(game: Game): Alias[] {
  const map = new Map<string, Alias>();
  const add = (phrase: string, sideId: string, generic = false) => {
    const key = normalizeSpeech(phrase);
    if (!key) return;
    const existing = map.get(key);
    if (existing) existing.sideIds.add(sideId);
    else map.set(key, { words: key.split(' '), sideIds: new Set([sideId]), generic });
  };
  game.sides.forEach((side, i) => {
    add(side.name, side.id);
    for (const pid of side.participantIds) {
      const name = game.participants.find((p) => p.id === pid)?.name ?? '';
      add(name, side.id);
      const first = normalizeSpeech(name).split(' ')[0];
      if (first && first.length >= 2) add(first, side.id);
    }
    const n = i + 1;
    for (const label of ['equipo', 'pareja', 'jugador', 'lado']) {
      add(`${label} ${n}`, side.id, true);
      for (const [word, value] of Object.entries(ORDINALS)) if (value === n) add(`${label} ${word}`, side.id, true);
      for (const color of COLOR_WORDS[i] ?? []) add(`${label} ${color}`, side.id, true);
    }
    for (const color of COLOR_WORDS[i] ?? []) add(`los ${color}s`, side.id, true);
  });
  return [...map.values()];
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Interpreta la transcripción contra la partida activa. */
export function parseVoiceCommand(transcript: string, game: Game): VoiceProposal {
  const issues: string[] = [];
  const text = normalizeSpeech(transcript);
  if (!text) {
    return { transcript, points: null, numbers: [], sideId: null, candidateSideIds: [], issues: ['No se escuchó ninguna frase.'], ready: false };
  }

  // 1. Destinatario: frases conocidas, de la más larga a la más corta, sin solaparse.
  const aliases = buildAliases(game).sort((a, b) => b.words.length - a.words.length);
  const words = text.split(' ');
  const used = new Array(words.length).fill(false);
  const matches: Alias[] = [];
  for (const alias of aliases) {
    for (let i = 0; i + alias.words.length <= words.length; i++) {
      const span = words.slice(i, i + alias.words.length);
      if (span.join(' ') === alias.words.join(' ') && !used.slice(i, i + alias.words.length).some(Boolean)) {
        for (let k = i; k < i + alias.words.length; k++) used[k] = true;
        matches.push(alias);
      }
    }
  }
  const specific = matches.filter((m) => !m.generic);
  const relevant = specific.length ? specific : matches;
  const mentioned = new Set(relevant.flatMap((m) => [...m.sideIds]));
  let sideId: string | null = null;
  let candidateSideIds: string[] = [];
  if (mentioned.size === 1) {
    sideId = [...mentioned][0];
  } else if (mentioned.size > 1) {
    candidateSideIds = [...mentioned];
    const sharedName = relevant.some((m) => m.sideIds.size > 1);
    issues.push(sharedName ? 'El nombre coincide con más de un jugador o equipo. Elige a quién.' : 'Se mencionó a más de un jugador o equipo. Elige a quién.');
  } else {
    // Sin coincidencia exacta: sugerir nombres parecidos, pero sin elegir por el usuario.
    const names = game.sides.flatMap((s) => [
      { side: s.id, name: normalizeSpeech(s.name) },
      ...s.participantIds.map((pid) => ({ side: s.id, name: normalizeSpeech(game.participants.find((p) => p.id === pid)?.name ?? '') })),
    ]);
    const suggestions = new Set<string>();
    for (const w of words.filter((x, i) => !used[i] && x.length >= 3 && !isNumberWord(x) && !/^\d+$/.test(x))) {
      for (const n of names) {
        for (const part of n.name.split(' ').filter((p) => p.length >= 3)) {
          const limit = part.length >= 6 ? 2 : 1;
          if (levenshtein(w, part) <= limit) suggestions.add(n.side);
        }
      }
    }
    candidateSideIds = [...suggestions];
    issues.push(
      candidateSideIds.length
        ? 'No reconocí el nombre con seguridad. ¿Te refieres a alguno de estos?'
        : 'No reconocí a quién se le anotan los puntos. Elige el jugador o equipo.',
    );
  }

  // 2. Puntos: se ignoran las palabras que forman parte de un nombre ("equipo 1").
  const remaining = words.filter((_, i) => !used[i]).join(' ');
  const numbers = extractNumbers(remaining);
  let points: number | null = null;
  if (numbers.length === 0) {
    issues.push('No escuché cuántos puntos son. Escríbelos.');
  } else if (new Set(numbers).size > 1) {
    issues.push(`Escuché varios números (${numbers.join(', ')}). Indica cuál es el correcto.`);
  } else if (numbers[0] > MAX_HAND_POINTS) {
    issues.push(`${numbers[0]} supera el máximo de ${MAX_HAND_POINTS} puntos por mano.`);
  } else {
    points = numbers[0];
  }

  return {
    transcript,
    points,
    numbers,
    sideId,
    candidateSideIds,
    issues,
    ready: points !== null && sideId !== null,
  };
}
