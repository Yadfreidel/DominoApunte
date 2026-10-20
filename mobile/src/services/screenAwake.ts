// Controlador global de «Mantener pantalla encendida» (uno para toda la app, fuera del árbol de
// pantallas, así que navegar o abrir ventanas no lo libera).
// - Web / PWA: Screen Wake Lock API (services/wakeLock.ts).
// - iOS / Android (compilación nativa): expo-keep-awake, activo solo en primer plano.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';
import { createWebWakeLock, type WakeLockController, type WakeLockEnv, type WakeStatus } from './wakeLock.ts';

export type { WakeStatus } from './wakeLock.ts';

const TAG = 'domino-pantalla';

function createNativeKeepAwake(): WakeLockController {
  const subscribers = new Set<() => void>();
  let wanted = false;
  let status: WakeStatus = 'apagado';
  let error: string | null = null;
  let sub: NativeEventSubscription | null = null;
  const set = (next: WakeStatus) => {
    if (next === status) return;
    status = next;
    subscribers.forEach((fn) => fn());
  };
  const activate = async () => {
    if (!wanted || AppState.currentState !== 'active') return false;
    set('solicitando');
    try {
      await activateKeepAwakeAsync(TAG);
      if (!wanted) return false;
      error = null;
      set('activo');
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      set('bloqueado');
      return false;
    }
  };
  const deactivate = () => {
    deactivateKeepAwake(TAG).catch(() => undefined);
  };
  return {
    supported: true,
    start() {
      if (wanted) return;
      wanted = true;
      sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void activate();
        else {
          deactivate();
          if (wanted) set('en-pausa');
        }
      });
      void activate();
    },
    stop() {
      if (!wanted) return;
      wanted = false;
      sub?.remove();
      sub = null;
      deactivate();
      set('apagado');
    },
    retry: activate,
    status: () => status,
    lastError: () => error,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    isHeld: () => status === 'activo',
  };
}

let controller: WakeLockController | null = null;

/** El controlador único de la app (se crea al primer uso). */
export function screenAwake(): WakeLockController {
  if (controller) return controller;
  if (Platform.OS === 'web') {
    const hasDom = typeof document !== 'undefined' && typeof navigator !== 'undefined';
    controller = createWebWakeLock(
      hasDom
        ? { wakeLock: (navigator as unknown as WakeLockEnv).wakeLock, document, window }
        : { document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} } },
    );
  } else {
    controller = createNativeKeepAwake();
  }
  return controller;
}

/** Estado real del bloqueo (no la preferencia), para mostrarlo en la interfaz. */
export function useScreenAwakeStatus(): WakeStatus {
  const c = screenAwake();
  return useSyncExternalStore(c.subscribe, c.status, c.status);
}
