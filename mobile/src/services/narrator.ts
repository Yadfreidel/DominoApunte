// Voz del narrador: cola breve de anuncios, prioridad de la victoria, pausa mientras se escucha el
// micrófono y anuncios en pantalla cuando no hay voz. Nunca lanza errores ni bloquea el marcador.
// - Web / PWA: speechSynthesis del navegador, llamado directamente (en iPhone la primera locución
//   debe salir de un toque: «Probar voz» o activar el narrador la desbloquean).
// - iOS / Android: expo-speech (voces del sistema).
// No envía nombres ni resultados a ningún servicio externo; algunas voces del navegador sí usan
// internet (se informa en Configuración: «voz en línea»).
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { pickSpanishVoice, type Narration, type VoiceOption } from '@/domain/narrator.ts';
import { DEFAULT_NARRATOR, type NarratorSettings } from '@/domain/repository.ts';

const STALE_MS = 8_000;
const STALE_VICTORY_MS = 20_000;
const MAX_QUEUE = 3;
const CAPTION_MS = 4_500;

export interface NarratorState {
  /** Anuncio en pantalla (también cuando no hay voz). */
  caption: { id: string; text: string } | null;
  speaking: boolean;
}

type Item = { n: Narration; at: number };

let settings: NarratorSettings = DEFAULT_NARRATOR;
let queue: Item[] = [];
let current: Item | null = null;
let listening = false;
const spoken = new Set<string>();
let state: NarratorState = { caption: null, speaking: false };
const subscribers = new Set<() => void>();
let captionTimer: ReturnType<typeof setTimeout> | null = null;
let voice: VoiceOption | null | undefined; // undefined = aún no buscada
let voicePromise: Promise<VoiceOption | null> | null = null;

const isWeb = Platform.OS === 'web';
const synth = (): SpeechSynthesis | null => (isWeb && typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

function set(next: Partial<NarratorState>) {
  state = { ...state, ...next };
  subscribers.forEach((fn) => fn());
}

function deviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'es-ES';
  }
}

async function loadVoices(): Promise<VoiceOption[]> {
  if (isWeb) {
    const s = synth();
    if (!s) return [];
    const read = () => s.getVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
    let list = read();
    // Algunos navegadores cargan las voces después; se espera como máximo 1,5 s.
    for (let i = 0; i < 6 && !list.length; i++) {
      await new Promise((r) => setTimeout(r, 250));
      list = read();
    }
    return list;
  }
  try {
    const list = await Speech.getAvailableVoicesAsync();
    return list.map((v) => ({ id: v.identifier, name: v.name, lang: v.language, local: true }));
  } catch {
    return [];
  }
}

/** Voz en español elegida (null si el dispositivo no tiene). */
export function findVoice(): Promise<VoiceOption | null> {
  if (voice !== undefined) return Promise.resolve(voice);
  if (!voicePromise) {
    voicePromise = loadVoices().then((list) => {
      voice = pickSpanishVoice(list, deviceLocale());
      return voice;
    });
  }
  return voicePromise;
}

function showCaption(n: Narration) {
  if (captionTimer) clearTimeout(captionTimer);
  set({ caption: { id: n.id, text: n.text } });
  captionTimer = setTimeout(() => set({ caption: null }), CAPTION_MS);
}

function finish() {
  current = null;
  set({ speaking: false });
  setTimeout(next, 150);
}

/** Habla ya (sin esperas): en la web se llama dentro del mismo toque cuando lo hay. */
function speakNow(text: string, onEnd: () => void): boolean {
  const v = voice;
  if (!v || settings.muted) return false;
  const opts = { volume: settings.volume, rate: settings.rate };
  if (isWeb) {
    const s = synth();
    if (!s) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const native = s.getVoices().find((x) => x.voiceURI === v.id);
      if (native) u.voice = native;
      u.lang = v.lang;
      u.volume = opts.volume;
      u.rate = opts.rate;
      u.onend = onEnd;
      u.onerror = onEnd;
      s.speak(u);
      return true;
    } catch {
      return false;
    }
  }
  try {
    Speech.speak(text, { voice: v.id, language: v.lang, volume: opts.volume, rate: opts.rate, onDone: onEnd, onStopped: onEnd, onError: onEnd });
    return true;
  } catch {
    return false;
  }
}

function stopVoice() {
  try {
    if (isWeb) synth()?.cancel();
    else void Speech.stop();
  } catch {
    // ignorado
  }
}

function next() {
  if (current || listening || !settings.enabled) return;
  const now = Date.now();
  queue = queue.filter((it) => now - it.at <= (it.n.kind === 'victoria' ? STALE_VICTORY_MS : STALE_MS));
  const item = queue.shift();
  if (!item) return;
  current = item;
  showCaption(item.n);
  set({ speaking: true });
  void findVoice().then(() => {
    if (current !== item) return;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (current === item) finish();
    };
    if (!speakNow(item.n.text, end)) {
      // Sin voz (o silenciado): el anuncio queda en pantalla el tiempo de lectura.
      setTimeout(end, 2_000);
    } else {
      // Algunos navegadores no avisan cuando terminan de hablar: la cola nunca se queda atascada.
      setTimeout(end, Math.max(4_000, item.n.text.length * 110) / Math.max(0.5, settings.rate));
    }
  });
}

export const narrator = {
  configure(next: NarratorSettings) {
    const wasEnabled = settings.enabled;
    settings = next;
    if (!next.enabled && wasEnabled) this.stopAll();
    if (next.muted) stopVoice();
  },
  settings: () => settings,
  /** Encola anuncios. Cada evento se anuncia una sola vez (por su id); la victoria pasa primero. */
  announce(items: Narration[], delayMs = 0) {
    if (!settings.enabled) return;
    const fresh = items.filter((n) => settings.events[n.kind] && !spoken.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => spoken.add(n.id));
    const push = () => {
      const at = Date.now();
      for (const n of fresh) {
        if (n.kind === 'victoria') {
          // La victoria interrumpe y descarta lo pendiente de esa partida.
          queue = queue.filter((it) => it.n.gameId !== n.gameId && it.n.priority >= n.priority);
          if (current && current.n.kind !== 'victoria') {
            stopVoice();
            current = null;
            set({ speaking: false });
          }
          queue.unshift({ n, at });
        } else {
          queue.push({ n, at });
        }
      }
      queue.sort((a, b) => b.n.priority - a.n.priority || a.at - b.at);
      queue = queue.slice(0, MAX_QUEUE);
      next();
    };
    if (delayMs > 0) setTimeout(push, delayMs);
    else push();
  },
  /** Una corrección o deshacer invalida lo pendiente de esa partida (menos la victoria ya anunciada). */
  invalidate(gameId: string) {
    queue = queue.filter((it) => it.n.gameId !== gameId || it.n.kind === 'victoria');
    if (current && current.n.gameId === gameId && current.n.kind !== 'victoria') {
      stopVoice();
      finish();
    }
  },
  /** Mientras el micrófono escucha, el narrador calla y espera. */
  setListening(value: boolean) {
    listening = value;
    if (value && current) {
      stopVoice();
      // El anuncio interrumpido vuelve a la cola (si sigue vigente al terminar de escuchar).
      queue.unshift(current);
      current = null;
      set({ speaking: false });
    }
    if (!value) setTimeout(next, 300);
  },
  stopAll() {
    queue = [];
    stopVoice();
    current = null;
    if (captionTimer) clearTimeout(captionTimer);
    set({ speaking: false, caption: null });
  },
  /**
   * Prueba de voz (llamar desde un toque: también desbloquea el audio en iPhone). Devuelve la voz
   * usada o null si no hay voz en español.
   */
  async test(): Promise<VoiceOption | null> {
    const text = '¡Hola! Así sonará el narrador de la partida.';
    // En la web se intenta hablar dentro del mismo toque, con la voz si ya se conoce.
    if (voice) {
      stopVoice();
      speakNow(text, () => undefined);
      return voice;
    }
    const v = await findVoice();
    if (v) speakNow(text, () => undefined);
    return v;
  },
  subscribe(fn: () => void) {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },
  getState: () => state,
  /** Solo para pruebas. */
  _reset() {
    queue = [];
    current = null;
    spoken.clear();
    listening = false;
    state = { caption: null, speaking: false };
  },
  _queue: () => queue.map((i) => i.n.id),
};
