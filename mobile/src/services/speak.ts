import * as Speech from 'expo-speech';

/**
 * Lee un texto en voz alta en español con la voz del sistema (en la web, la del navegador).
 * Devuelve false si el dispositivo no ofrece síntesis de voz; nunca lanza errores.
 */
export async function speakSpanish(text: string): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !('speechSynthesis' in window)) return false;
    await Speech.stop();
    Speech.speak(text, { language: 'es-ES', rate: 0.95 });
    return true;
  } catch {
    return false;
  }
}

/** Detiene la lectura en curso (al salir de la pantalla). */
export function stopSpeaking(): void {
  Speech.stop().catch(() => undefined);
}
