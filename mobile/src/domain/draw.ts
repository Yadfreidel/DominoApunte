// Sorteos: parejas aleatorias y jugador que sale. El generador aleatorio se puede inyectar
// para que las pruebas sean reproducibles.

export type Rng = () => number;

/** Mezcla Fisher–Yates; no modifica el arreglo original. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class DrawError extends Error {}

/** Forma parejas aleatorias sin repetir a nadie. Exige una cantidad par de al menos 2. */
export function drawPairs<T>(items: readonly T[], rng: Rng = Math.random): [T, T][] {
  if (items.length < 2) throw new DrawError('Se necesitan al menos 2 jugadores para formar parejas.');
  if (items.length % 2 !== 0) {
    throw new DrawError(`Hay ${items.length} jugadores: para formar parejas la cantidad debe ser par.`);
  }
  const mixed = shuffle(items, rng);
  const pairs: [T, T][] = [];
  for (let i = 0; i < mixed.length; i += 2) pairs.push([mixed[i], mixed[i + 1]]);
  return pairs;
}

/** Índice aleatorio entre 0 y n-1. */
export function drawIndex(n: number, rng: Rng = Math.random): number {
  if (!Number.isInteger(n) || n < 1) throw new DrawError('No hay a quién sortear.');
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Generador determinista (mulberry32) para pruebas. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
