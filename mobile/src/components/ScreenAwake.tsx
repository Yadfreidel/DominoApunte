// Mantiene la pantalla encendida mientras la app está visible (ajuste «Mantener la pantalla
// encendida» en Configuración, activado por defecto).
// - Web / app instalada (PWA): Screen Wake Lock API, que se vuelve a pedir al regresar a la app.
// - iOS / Android: expo-keep-awake, activado solo mientras la app está en primer plano.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { createWebWakeLock, type WakeLockEnv } from '@/services/wakeLock';
import { useStore } from '@/state/AppStore';

const TAG = 'domino-pantalla';

export function ScreenAwake() {
  const { settings, ready } = useStore();
  const enabled = ready && settings.keepAwake;

  useEffect(() => {
    if (!enabled) return;
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
      const lock = createWebWakeLock({ wakeLock: (navigator as unknown as WakeLockEnv).wakeLock, document });
      lock.start();
      return () => lock.stop();
    }
    const activate = () => activateKeepAwakeAsync(TAG).catch(() => undefined);
    const deactivate = () => {
      deactivateKeepAwake(TAG).catch(() => undefined);
    };
    void activate();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? void activate() : deactivate()));
    return () => {
      sub.remove();
      deactivate();
    };
  }, [enabled]);

  return null;
}
