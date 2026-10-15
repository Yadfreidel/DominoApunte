import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { drawIndex } from '@/domain/draw.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { Button } from './ui';

/** Respeta "Reducir movimiento" del sistema y el ajuste propio de la app. */
export function useReduceMotion(): boolean {
  const { settings } = useStore();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setSystem(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return system || settings.reduceMotion;
}

/**
 * Sorteo de quién sale. El resultado se decide al pulsar y se entrega con onResult; la animación
 * (recorrer los nombres durante ~1,2 s) es solo visual. El resultado confirmado lo guarda la
 * pantalla que lo usa, así que no se vuelve a sortear al recargar.
 */
export function StarterDraw({
  names,
  value,
  onResult,
  disabled,
}: {
  names: string[];
  value: number | null;
  onResult: (index: number | null) => void;
  disabled?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const [rolling, setRolling] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const valid = names.length >= 2 && names.every((n) => n.trim());

  const draw = () => {
    if (!valid || rolling != null) return;
    const result = drawIndex(names.length);
    if (reduceMotion) {
      onResult(result);
      AccessibilityInfo.announceForAccessibility?.(`Sale ${names[result]}`);
      return;
    }
    let step = 0;
    const steps = 12 + result + names.length * 2;
    setRolling(0);
    timer.current = setInterval(() => {
      step++;
      setRolling(step % names.length);
      if (step >= steps - (steps % names.length) + result) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setRolling(null);
        onResult(result);
        AccessibilityInfo.announceForAccessibility?.(`Sale ${names[result]}`);
      }
    }, 70);
  };

  const shown = rolling ?? value;

  return (
    <View style={s.box}>
      <View style={s.row}>
        {names.map((n, i) => (
          <View key={i} style={[s.chip, shown === i && s.chipActive]}>
            {shown === i && rolling == null ? <Ionicons name="play" size={14} color={colors.onLime} /> : null}
            <Text style={[s.chipText, shown === i && { color: colors.onLime }]} numberOfLines={1}>
              {n.trim() || `Jugador ${i + 1}`}
            </Text>
          </View>
        ))}
      </View>
      {value != null && rolling == null ? (
        <Text style={s.result} accessibilityLiveRegion="polite">
          Sale: <Text style={{ color: colors.lime }}>{names[value]}</Text>
        </Text>
      ) : null}
      <View style={s.row}>
        <Button
          label={value == null ? 'Sortear quién sale' : 'Volver a sortear'}
          icon="shuffle"
          variant="outline"
          size="sm"
          onPress={draw}
          disabled={disabled || !valid || rolling != null}
          style={{ flexGrow: 1 }}
        />
        {value != null ? <Button label="Quitar" variant="ghost" size="sm" onPress={() => onResult(null)} disabled={rolling != null} /> : null}
      </View>
      {!valid ? <Text style={s.hint}>Escribe todos los nombres para sortear quién sale.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  chipActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  chipText: { color: colors.textMuted, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  result: { color: colors.text, fontFamily: fonts.heading, fontSize: 20 },
  hint: { color: colors.textDim, fontSize: 12 },
});
