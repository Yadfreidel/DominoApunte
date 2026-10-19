import { Platform, Share } from 'react-native';

/** Dirección pública de la app para armar enlaces (invitaciones, pantalla grande). */
export function appBaseUrl(): string {
  if (Platform.OS === 'web' && typeof location !== 'undefined') return location.origin;
  return (process.env.EXPO_PUBLIC_APP_URL || 'https://dominoapunte-mobile.vercel.app').replace(/\/+$/, '');
}

/**
 * Comparte un texto o enlace con el menú del sistema; si no existe (navegador de escritorio),
 * lo copia al portapapeles. Nunca envía nada sin que el usuario lo pida.
 */
export async function shareOrCopy(title: string, text: string): Promise<'compartido' | 'copiado' | 'no'> {
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        await nav.share({ title, text });
        return 'compartido';
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        return 'copiado';
      }
      return 'no';
    }
    await Share.share({ title, message: text });
    return 'compartido';
  } catch {
    return 'no';
  }
}

/** Copia al portapapeles (solo web; en el teléfono se usa el menú de compartir). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sin permiso
  }
  return false;
}
