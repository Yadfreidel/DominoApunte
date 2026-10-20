// Mantiene la pantalla encendida mientras la app está visible (ajuste «Mantener pantalla encendida»
// en Configuración, activado por defecto). Vive en el layout raíz: se aplica a todas las pantallas,
// ventanas y celebraciones, y no se libera al navegar. La lógica está en services/screenAwake.ts.
// Si el dispositivo no lo permite, muestra un aviso breve (una vez por sesión) con un botón para
// reintentarlo con un toque.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { screenAwake, useScreenAwakeStatus } from '@/services/screenAwake';
import { useStore } from '@/state/AppStore';
import { colors, radius, space } from '@/theme';

// Avisos ya cerrados en esta sesión (por estado), para no insistir.
const dismissed = new Set<string>();

export function ScreenAwake() {
  const { settings, ready } = useStore();
  const enabled = ready && settings.keepAwake;
  const status = useScreenAwakeStatus();
  const insets = useSafeAreaInsets();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const c = screenAwake();
    c.start();
    return () => c.stop();
  }, [enabled]);

  const notice = enabled && (status === 'bloqueado' || status === 'sin-soporte') && !dismissed.has(status);
  // El aviso de «sin soporte» es informativo: se oculta solo tras unos segundos.
  useEffect(() => {
    if (!notice || status !== 'sin-soporte') return;
    const t = setTimeout(() => {
      dismissed.add('sin-soporte');
      setTick((n) => n + 1);
    }, 8000);
    return () => clearTimeout(t);
  }, [notice, status]);

  if (!notice) return null;
  const close = () => {
    dismissed.add(status);
    setTick((n) => n + 1);
  };
  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + space.sm }]}>
      <View style={s.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Ionicons name="sunny-outline" size={20} color={colors.warning} />
        <Text style={s.text}>
          {status === 'sin-soporte'
            ? 'Este navegador no permite mantener la pantalla encendida.'
            : 'El teléfono no permitió mantener la pantalla encendida.'}
        </Text>
        {status === 'bloqueado' ? (
          <Pressable
            onPress={() => void screenAwake().retry()}
            accessibilityRole="button"
            accessibilityLabel="Mantener pantalla encendida"
            style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.actionText}>Mantener pantalla encendida</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar aviso" hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md, zIndex: 1000 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    maxWidth: 560,
    width: '100%',
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1.5,
    borderColor: colors.warning,
    borderRadius: radius.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  text: { flex: 1, minWidth: 160, color: colors.text, fontSize: 14 },
  action: { backgroundColor: colors.warning, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 },
  actionText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
});
