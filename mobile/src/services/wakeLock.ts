// Pantalla encendida en la web y la app instalada (PWA), con la Screen Wake Lock API.
// El navegador suelta el bloqueo cuando la página queda oculta; aquí se vuelve a pedir al regresar y
// se libera explícitamente al ocultarse. Sin soporte (o si el navegador lo rechaza) no pasa nada:
// la app sigue funcionando y la pantalla se apaga según el ajuste del teléfono.
// Código sin React Native para poder probarlo con Node (tests/victoria.test.ts).

interface Sentinel {
  released?: boolean;
  release(): Promise<void>;
}

export interface WakeLockEnv {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
  document: {
    visibilityState: string;
    addEventListener(type: 'visibilitychange', fn: () => void): void;
    removeEventListener(type: 'visibilitychange', fn: () => void): void;
  };
}

export interface WakeLockController {
  /** true si el navegador ofrece la Screen Wake Lock API. */
  supported: boolean;
  start(): void;
  stop(): void;
  /** true mientras el bloqueo está concedido. */
  isHeld(): boolean;
}

export function createWebWakeLock(env: WakeLockEnv): WakeLockController {
  const api = env.wakeLock;
  let wanted = false;
  let sentinel: Sentinel | null = null;
  let requesting = false;

  const acquire = async () => {
    if (!api || !wanted || requesting || env.document.visibilityState !== 'visible') return;
    if (sentinel && !sentinel.released) return;
    requesting = true;
    try {
      const s = await api.request('screen');
      if (!wanted || env.document.visibilityState !== 'visible') await s.release().catch(() => undefined);
      else sentinel = s;
    } catch {
      // Rechazado (sin permiso, batería baja, iframe sin permiso…): se juega igual.
      sentinel = null;
    } finally {
      requesting = false;
    }
  };

  const release = () => {
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) s.release().catch(() => undefined);
  };

  const onVisibility = () => {
    if (env.document.visibilityState === 'visible') void acquire();
    else release();
  };

  return {
    supported: !!api,
    start() {
      if (wanted) return;
      wanted = true;
      env.document.addEventListener('visibilitychange', onVisibility);
      void acquire();
    },
    stop() {
      if (!wanted) return;
      wanted = false;
      env.document.removeEventListener('visibilitychange', onVisibility);
      release();
    },
    isHeld: () => !!sentinel && !sentinel.released,
  };
}
