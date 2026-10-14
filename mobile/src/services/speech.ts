// Reconocimiento de voz del sistema (Apple / Google en el teléfono; Web Speech API en el navegador).
// La librería es un módulo nativo: en Expo Go no existe y su carga lanza un error, por eso se carga
// de forma protegida y la app ofrece la anotación manual cuando no está disponible.
import { Platform } from 'react-native';
import type * as SpeechLib from 'expo-speech-recognition';

type SpeechModule = typeof SpeechLib.ExpoSpeechRecognitionModule;

let speechModule: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speechModule = (require('expo-speech-recognition') as typeof SpeechLib).ExpoSpeechRecognitionModule;
} catch {
  speechModule = null;
}

export type SpeechAvailability = { available: true } | { available: false; reason: string };

export function speechAvailability(): SpeechAvailability {
  if (!speechModule) {
    return {
      available: false,
      reason:
        Platform.OS === 'web'
          ? 'Este navegador no ofrece reconocimiento de voz. Usa Chrome o Safari.'
          : 'La anotación por voz necesita la versión instalable de la app (no funciona dentro de Expo Go).',
    };
  }
  try {
    if (!speechModule.isRecognitionAvailable()) {
      return {
        available: false,
        reason:
          Platform.OS === 'web'
            ? 'Este navegador no ofrece reconocimiento de voz. Usa Chrome o Safari.'
            : 'El reconocimiento de voz no está disponible en este dispositivo.',
      };
    }
  } catch {
    return { available: false, reason: 'El reconocimiento de voz no está disponible en este dispositivo.' };
  }
  return { available: true };
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'No hay permiso para usar el micrófono. Actívalo en los ajustes del teléfono.',
  'service-not-allowed': 'El reconocimiento de voz está desactivado en este dispositivo.',
  'language-not-supported': 'El reconocimiento de voz en español no está disponible en este dispositivo.',
  network: 'El reconocimiento de voz necesita conexión a internet en este dispositivo.',
  'no-speech': 'No se escuchó nada. Inténtalo de nuevo hablando cerca del teléfono.',
  'speech-timeout': 'No se escuchó nada. Inténtalo de nuevo.',
  'audio-capture': 'No se pudo usar el micrófono. ¿Lo está usando otra app?',
  interrupted: 'La grabación se interrumpió (llamada o alarma).',
  busy: 'El reconocimiento de voz está ocupado. Espera un momento.',
};

export function speechErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? 'No se pudo reconocer la voz. Puedes escribir los puntos a mano.';
}

/** Español con la variante del dispositivo si es española (es-DO, es-MX…); si no, es-ES. */
function speechLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (/^es[-_][A-Za-z]{2}/.test(locale)) return locale.replace('_', '-').slice(0, 5);
  } catch {
    // sin Intl
  }
  return 'es-ES';
}

export interface ListenHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(code: string): void;
  onEnd(): void;
}

let activeSession: { cancel(): void } | null = null;

/**
 * Inicia una escucha. Solo puede haber una a la vez: iniciar otra cancela la anterior.
 * Devuelve una función que cancela la escucha y libera el micrófono.
 */
export async function listenOnce(handlers: ListenHandlers, contextualStrings: string[]): Promise<() => void> {
  if (!speechModule) throw new Error('unavailable');
  activeSession?.cancel();

  const perm = await speechModule.requestPermissionsAsync();
  if (!perm.granted) {
    handlers.onError('not-allowed');
    handlers.onEnd();
    return () => undefined;
  }

  let finished = false;
  const subs = [
    speechModule.addListener('result', (e) => {
      if (finished) return;
      const text = e.results[0]?.transcript ?? '';
      if (e.isFinal) handlers.onFinal(text);
      else handlers.onPartial(text);
    }),
    speechModule.addListener('nomatch', () => {
      if (!finished) handlers.onError('no-speech');
    }),
    speechModule.addListener('error', (e) => {
      if (!finished && e.error !== 'aborted') handlers.onError(e.error);
    }),
    speechModule.addListener('end', () => cleanup(false)),
  ];

  function cleanup(abort: boolean) {
    if (finished) return;
    finished = true;
    subs.forEach((s) => s.remove());
    if (abort) {
      try {
        speechModule?.abort();
      } catch {
        // ya estaba detenido
      }
    }
    if (activeSession === session) activeSession = null;
    handlers.onEnd();
  }

  const session = { cancel: () => cleanup(true) };
  activeSession = session;

  speechModule.start({
    lang: speechLocale(),
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    // Mejora el reconocimiento de los nombres de la partida (iOS y Android 13+).
    contextualStrings: contextualStrings.slice(0, 50),
  });
  return session.cancel;
}

/** Termina de escuchar y procesa lo dicho hasta ahora. */
export function stopListening() {
  try {
    speechModule?.stop();
  } catch {
    // ignorado
  }
}
