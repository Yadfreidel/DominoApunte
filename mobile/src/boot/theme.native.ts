// iOS / Android: lee el tema guardado de forma síncrona antes de que se cree cualquier estilo.
import * as SecureStore from 'expo-secure-store';

export const APPEARANCE_KEY = 'domino_appearance';

try {
  const raw = SecureStore.getItem(APPEARANCE_KEY);
  if (raw) (globalThis as { __DOMINO_APPEARANCE__?: unknown }).__DOMINO_APPEARANCE__ = JSON.parse(raw);
} catch {
  // Sin tema guardado o ilegible: se usa el tema original.
}
