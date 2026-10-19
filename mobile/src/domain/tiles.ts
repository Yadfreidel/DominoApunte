// Conteo de fichas: fichas detectadas o agregadas a mano, agrupadas por foto.
// El total siempre se calcula aquí sumando mitades; nunca se toma de un servicio externo.

export type TileSetId = 'doble6' | 'doble9' | 'doble12';

export const TILE_SETS: { id: TileSetId; label: string; max: number }[] = [
  { id: 'doble6', label: 'Doble seis', max: 6 },
  { id: 'doble9', label: 'Doble nueve', max: 9 },
  { id: 'doble12', label: 'Doble doce', max: 12 },
];

export const setMax = (set: TileSetId) => TILE_SETS.find((s) => s.id === set)!.max;

export interface TileBox {
  /** Coordenadas normalizadas 0–1 respecto a la foto. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile {
  id: string;
  left: number | null;
  right: number | null;
  box: TileBox | null;
  /** 'revisar' mientras haya dudas; pasa a 'ok' cuando el usuario corrige o confirma. */
  status: 'ok' | 'revisar';
  reviewReason: string;
  source: 'detectada' | 'manual';
}

export interface TileGroup {
  id: string;
  set: TileSetId;
  /** URI local de la foto (solo en memoria; no se guarda). */
  photoUri: string | null;
  /** Ancho / alto de la foto, para dibujar las marcas. */
  photoAspect?: number;
  tiles: Tile[];
  imageIssues: string[];
  /** Un grupo confirmado suma al total de la mano; uno sin confirmar no. */
  confirmed: boolean;
}

export const tileValue = (t: Tile) => (t.left ?? 0) + (t.right ?? 0);

export function tileProblem(t: Tile, max: number): string | null {
  if (t.left === null || t.right === null) return 'Falta el valor de una mitad.';
  if (!Number.isInteger(t.left) || !Number.isInteger(t.right) || t.left < 0 || t.right < 0 || t.left > max || t.right > max) {
    return `Cada mitad debe ser un número entero entre 0 y ${max}.`;
  }
  if (t.status === 'revisar') return t.reviewReason || 'Revisa esta ficha.';
  return null;
}

export function groupTotal(group: TileGroup): number {
  return group.tiles.reduce((n, t) => n + tileValue(t), 0);
}

/** Un grupo se puede confirmar cuando no quedan fichas con dudas ni valores inválidos. */
export function groupProblems(group: TileGroup): { tileId: string; problem: string }[] {
  const max = setMax(group.set);
  return group.tiles
    .map((t) => ({ tileId: t.id, problem: tileProblem(t, max) }))
    .filter((x): x is { tileId: string; problem: string } => x.problem !== null);
}

export function handTotal(groups: TileGroup[]): number {
  return groups.filter((g) => g.confirmed).reduce((n, g) => n + groupTotal(g), 0);
}

/** Actualiza una ficha; cualquier cambio del usuario cuenta como revisión de esa ficha. */
export function editTile(group: TileGroup, tileId: string, changes: { left?: number | null; right?: number | null }): TileGroup {
  return {
    ...group,
    confirmed: false,
    tiles: group.tiles.map((t) =>
      t.id === tileId ? { ...t, ...changes, status: 'ok', reviewReason: '' } : t,
    ),
  };
}

/** Marca una ficha como revisada sin cambiar sus valores (el usuario confirma que está bien). */
export function markReviewed(group: TileGroup, tileId: string): TileGroup {
  return {
    ...group,
    confirmed: false,
    tiles: group.tiles.map((t) => (t.id === tileId && t.left !== null && t.right !== null ? { ...t, status: 'ok', reviewReason: '' } : t)),
  };
}

export function removeTile(group: TileGroup, tileId: string): TileGroup {
  return { ...group, confirmed: false, tiles: group.tiles.filter((t) => t.id !== tileId) };
}

export function addManualTile(group: TileGroup, tileId: string): TileGroup {
  return {
    ...group,
    confirmed: false,
    tiles: [...group.tiles, { id: tileId, left: null, right: null, box: null, status: 'revisar', reviewReason: 'Ficha agregada a mano: escribe sus valores.', source: 'manual' }],
  };
}

export function confirmGroup(group: TileGroup): TileGroup {
  if (groupProblems(group).length) throw new Error('Revisa las fichas marcadas antes de confirmar el grupo.');
  if (group.tiles.length === 0) throw new Error('El grupo no tiene fichas.');
  return { ...group, confirmed: true };
}

/**
 * Agrega un grupo a la mano. Es idempotente por id: si una respuesta llega dos veces
 * (reintento, doble toque) el grupo no se suma dos veces.
 */
export function upsertGroup(groups: TileGroup[], group: TileGroup): TileGroup[] {
  return groups.some((g) => g.id === group.id) ? groups.map((g) => (g.id === group.id ? group : g)) : [...groups, group];
}

// Límites del nivel de alta resolución de los modelos de visión usados en el servidor
// (2576 px de lado y 4784 tokens visuales de 28x28 px). Si la foto cabe en ellos, el modelo no la
// reescala y las ubicaciones que devuelve coinciden con la foto mostrada en pantalla.
const VISION_MAX_EDGE = 2576;
const VISION_MAX_TOKENS = 4784;

function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Mayor tamaño con la misma proporción que el modelo procesa sin reescalar (fórmula de la documentación oficial). */
export function visionSize(width: number, height: number): [number, number] {
  const fits = (w: number, h: number) =>
    Math.ceil(w / 28) * 28 <= VISION_MAX_EDGE &&
    Math.ceil(h / 28) * 28 <= VISION_MAX_EDGE &&
    Math.ceil(w / 28) * Math.ceil(h / 28) <= VISION_MAX_TOKENS;
  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = visionSize(height, width);
    return [w, h];
  }
  const aspect = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspect), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspect), 1)];
}

/** Línea de una ficha para la lista: «Ficha 1: 6 | 4 = 10» («?» en la mitad que falta). */
export function tileLine(t: Tile, index: number): string {
  const half = (v: number | null) => (v === null ? '?' : String(v));
  const sum = t.left === null || t.right === null ? '?' : String(tileValue(t));
  return `Ficha ${index + 1}: ${half(t.left)} | ${half(t.right)} = ${sum}`;
}

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/** Número entero de 0 a 9999 en palabras (español). */
export function numberToSpanish(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 30) return UNITS[n];
  if (n < 100) {
    const u = n % 10;
    return u ? `${TENS[Math.floor(n / 10)]} y ${UNITS[u]}` : TENS[n / 10];
  }
  if (n === 100) return 'cien';
  if (n < 1000) {
    const rest = n % 100;
    return rest ? `${HUNDREDS[Math.floor(n / 100)]} ${numberToSpanish(rest)}` : HUNDREDS[n / 100];
  }
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${numberToSpanish(thousands)} mil`;
  return rest ? `${head} ${numberToSpanish(rest)}` : head;
}

/** Frase para «Escuchar total»: «El total es trece puntos». */
export function spokenTotal(total: number): string {
  if (total === 1) return 'El total es un punto';
  // «veintiuno puntos» → «veintiún puntos», «treinta y uno» → «treinta y un».
  const words = numberToSpanish(total).replace(/veintiuno$/, 'veintiún').replace(/ uno$/, ' un');
  return `El total es ${words} puntos`;
}
