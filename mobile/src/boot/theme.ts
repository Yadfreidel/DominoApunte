// Web: lee el tema guardado antes de que se cree cualquier estilo (ver index.js y theme.ts).
// El script de public/index.html ya pintó el fondo con el mismo tema para evitar destellos.
export const APPEARANCE_KEY = 'domino:appearance';

try {
  const raw = globalThis.localStorage?.getItem(APPEARANCE_KEY);
  if (raw) (globalThis as { __DOMINO_APPEARANCE__?: unknown }).__DOMINO_APPEARANCE__ = JSON.parse(raw);
} catch {
  // Almacenamiento no disponible: se usa el tema original.
}
