// Pantalla encendida en la web y la app instalada (PWA), con la Screen Wake Lock API.
// Un solo controlador global (sobrevive a la navegación) que:
// - pide el bloqueo cuando la página está visible y lo suelta al ocultarse;
// - lo vuelve a pedir al regresar (visibilitychange / pageshow);
// - escucha «release»: si el sistema lo suelta con la app visible, lo intenta una vez más y, si no,
//   espera al siguiente toque (sin bucles de reintentos);
// - si el navegador lo rechaza sin un toque (Safari en iPhone), lo pide en el siguiente toque;
// - informa el estado real: «activo» solo cuando el navegador lo concedió.
// No usa temporizadores, videos ocultos ni actividad simulada. Código sin React Native para
// poder probarlo con Node (tests/victoria.test.ts).

export interface WakeSentinel {
  released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', fn: () => void): void;
  removeEventListener?(type: 'release', fn: () => void): void;
}

type Listener = () => void;

export interface WakeLockEnv {
  wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> };
  document: {
    visibilityState: string;
    addEventListener(type: string, fn: Listener, options?: { capture?: boolean; passive?: boolean }): void;
    removeEventListener(type: string, fn: Listener, options?: { capture?: boolean }): void;
  };
  /** Objeto donde llega «pageshow» (window); opcional. */
  window?: {
    addEventListener(type: string, fn: Listener): void;
    removeEventListener(type: string, fn: Listener): void;
  };
}

/**
 * - apagado: el usuario desactivó la opción (o aún no se activó).
 * - sin-soporte: el navegador no ofrece la API (p. ej. el navegador interno de otra app).
 * - solicitando: pedido en curso.
 * - activo: concedido; la pantalla no se apaga mientras la app esté visible.
 * - en-pausa: la app no está visible; se pedirá al volver.
 * - requiere-toque: el navegador lo rechazó sin interacción; se pide en el siguiente toque.
 * - bloqueado: lo rechazó también tras un toque (ahorro de batería, política del sistema…).
 */
export type WakeStatus = 'apagado' | 'sin-soporte' | 'solicitando' | 'activo' | 'en-pausa' | 'requiere-toque' | 'bloqueado';

export interface WakeLockController {
  /** true si el navegador ofrece la Screen Wake Lock API. */
  supported: boolean;
  start(): void;
  stop(): void;
  /** Reintento explícito (botón «Mantener pantalla encendida»); llamarlo desde el toque. */
  retry(): Promise<boolean>;
  status(): WakeStatus;
  /** Último error del navegador (nombre), si hubo. */
  lastError(): string | null;
  subscribe(fn: Listener): () => void;
  /** true mientras el bloqueo está concedido. */
  isHeld(): boolean;
}

const GESTURES = ['click', 'touchend', 'pointerup', 'keydown'] as const;

export function createWebWakeLock(env: WakeLockEnv): WakeLockController {
  const api = env.wakeLock;
  const subscribers = new Set<Listener>();
  let wanted = false;
  let sentinel: WakeSentinel | null = null;
  let pending: Promise<boolean> | null = null;
  let status: WakeStatus = api ? 'apagado' : 'sin-soporte';
  let error: string | null = null;
  // Reintentos automáticos tras un «release» del sistema en el período visible actual (máx. 1).
  let autoRetries = 0;

  const visible = () => env.document.visibilityState === 'visible';
  const set = (next: WakeStatus) => {
    if (next === status) return;
    status = next;
    subscribers.forEach((fn) => fn());
  };
  const held = () => !!sentinel && !sentinel.released;

  const acquire = (fromGesture: boolean): Promise<boolean> => {
    if (!api) {
      set('sin-soporte');
      return Promise.resolve(false);
    }
    if (!wanted) return Promise.resolve(false);
    if (!visible()) {
      set('en-pausa');
      return Promise.resolve(false);
    }
    if (held()) {
      set('activo');
      return Promise.resolve(true);
    }
    if (pending) return pending;
    set('solicitando');
    // La llamada a request() ocurre de forma síncrona (dentro del toque, si lo hay).
    let request: Promise<WakeSentinel>;
    try {
      request = api.request('screen');
    } catch (err) {
      request = Promise.reject(err);
    }
    pending = (async () => {
      try {
        const s = await request;
        if (!wanted || !visible()) {
          await s.release().catch(() => undefined);
          set(wanted ? 'en-pausa' : 'apagado');
          return false;
        }
        sentinel = s;
        error = null;
        const onRelease = () => {
          s.removeEventListener?.('release', onRelease);
          if (sentinel !== s) return; // lo soltamos nosotros
          sentinel = null;
          if (!wanted) return set('apagado');
          if (!visible()) return set('en-pausa');
          // El sistema lo soltó con la app visible: un solo reintento automático.
          if (autoRetries < 1) {
            autoRetries++;
            void acquire(false);
          } else {
            set('requiere-toque');
          }
        };
        s.addEventListener?.('release', onRelease);
        set('activo');
        return true;
      } catch (err) {
        sentinel = null;
        error = err instanceof Error ? err.name || err.message : String(err);
        if (wanted && visible()) set(fromGesture ? 'bloqueado' : 'requiere-toque');
        else set(wanted ? 'en-pausa' : 'apagado');
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const release = () => {
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) s.release().catch(() => undefined);
  };

  const onVisibility = () => {
    if (!wanted) return;
    if (visible()) {
      autoRetries = 0;
      void acquire(false);
    } else {
      release();
      set('en-pausa');
    }
  };

  // Solo reintenta con un toque cuando falta el toque; si el sistema lo bloquea, espera al botón
  // o al regreso a la app (no insiste en cada toque).
  const onGesture = () => {
    if (wanted && status === 'requiere-toque' && visible()) void acquire(true);
  };

  return {
    supported: !!api,
    start() {
      if (wanted) return;
      wanted = true;
      if (!api) return set('sin-soporte');
      env.document.addEventListener('visibilitychange', onVisibility);
      env.window?.addEventListener('pageshow', onVisibility);
      for (const g of GESTURES) env.document.addEventListener(g, onGesture, { capture: true, passive: true });
      autoRetries = 0;
      void acquire(false);
    },
    stop() {
      if (!wanted) return;
      wanted = false;
      env.document.removeEventListener('visibilitychange', onVisibility);
      env.window?.removeEventListener('pageshow', onVisibility);
      for (const g of GESTURES) env.document.removeEventListener(g, onGesture, { capture: true });
      release();
      set(api ? 'apagado' : 'sin-soporte');
    },
    retry: () => acquire(true),
    status: () => status,
    lastError: () => error,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    isHeld: held,
  };
}
