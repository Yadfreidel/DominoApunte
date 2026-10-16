import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Appearance } from '@/domain/appearance.ts';

// Mismas claves que src/boot/theme(.native).ts y el script de public/index.html.
const WEB_KEY = 'domino:appearance';
const NATIVE_KEY = 'domino_appearance';

/** Guarda el tema en el dispositivo para aplicarlo desde el primer cuadro al abrir la app. */
export function storeAppearance(appearance: Appearance): void {
  const raw = JSON.stringify(appearance);
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(WEB_KEY, raw);
    else SecureStore.setItem(NATIVE_KEY, raw);
  } catch {
    // Sin almacenamiento disponible: el tema se aplicará cuando se pueda guardar.
  }
}

/** Recarga la app para aplicar el tema. Solo es posible en la versión web. */
export function reloadToApplyTheme(): boolean {
  if (Platform.OS !== 'web') return false;
  globalThis.location?.reload();
  return true;
}
