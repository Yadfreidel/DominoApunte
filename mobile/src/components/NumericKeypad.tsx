import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_HAND_POINTS, parsePoints } from '@/domain/game.ts';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { Button, ErrorText } from './ui';

export interface KeypadSide {
  id: string;
  name: string;
  index: number;
}

interface Props {
  visible: boolean;
  title: string;
  sides: KeypadSide[];
  initialSideId: string | null;
  initialValue?: string;
  confirmLabel?: string;
  /** Regla opcional de la partida: puntos para el rival cuando un jugador pasa (0 = sin botón). */
  passPoints?: number;
  onSubmit: (sideId: string, points: number) => Promise<void>;
  onClose: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;
const MAX_DIGITS = String(MAX_HAND_POINTS).length;

export function NumericKeypad({ visible, title, sides, initialSideId, initialValue = '', confirmLabel = 'Confirmar', passPoints = 0, onSubmit, onClose }: Props) {
  // El componente se monta de nuevo en cada apertura (key distinta), así que el estado inicial viene de las props.
  const [value, setValue] = useState(initialValue);
  const [sideId, setSideId] = useState<string | null>(initialSideId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bloqueo síncrono: evita que dos toques rápidos envíen la misma mano dos veces.
  const submitting = useRef(false);
  const insets = useSafeAreaInsets();

  const press = (key: (typeof KEYS)[number] | string) => {
    if (saving) return;
    setError(null);
    if (key === 'C') setValue('');
    else if (key === '⌫') setValue((v) => v.slice(0, -1));
    else setValue((v) => (v === '0' ? key : v.length >= MAX_DIGITS ? v : v + key));
  };

  const submit = async () => {
    if (submitting.current) return;
    if (!sideId) {
      setError('Elige a quién se le anotan los puntos.');
      return;
    }
    const parsed = parsePoints(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await onSubmit(sideId, parsed.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la mano.');
      submitting.current = false;
      setSaving(false);
    }
  };

  // Permite usar el teclado físico en la versión web/escritorio.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const activeIndex = sides.find((s) => s.id === sideId)?.index ?? 0;
  const accent = sideColor(activeIndex).main;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={saving ? undefined : onClose} accessibilityLabel="Cerrar teclado" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} disabled={saving} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </Pressable>
          </View>

          {sides.length > 1 ? (
            <View style={s.sides} accessibilityRole="radiogroup">
              {sides.map((side) => {
                const c = sideColor(side.index);
                const active = side.id === sideId;
                return (
                  <Pressable
                    key={side.id}
                    onPress={() => {
                      setSideId(side.id);
                      setError(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    style={[s.sideChip, active && { borderColor: c.main, backgroundColor: c.soft }]}
                  >
                    <View style={[s.dot, { backgroundColor: c.main }]} />
                    <Text style={[s.sideText, active && { color: c.main }]} numberOfLines={1}>
                      {side.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={[s.display, { borderColor: accent }]} accessibilityLabel={`Puntos: ${value || 'vacío'}`}>
            <Text style={[s.displayText, { color: value ? accent : colors.textDim }]}>{value || '0'}</Text>
            <Text style={s.displayUnit}>puntos</Text>
          </View>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {passPoints > 0 ? (
            <Button
              label={`Pase: ${passPoints} puntos`}
              icon="hand-left-outline"
              variant="outline"
              size="sm"
              onPress={() => {
                setValue(String(passPoints));
                setError(null);
              }}
              accessibilityHint="Escribe los puntos por pase de esta partida; elige a quién se anotan y confirma"
            />
          ) : null}

          <View style={s.grid}>
            {KEYS.map((k) => (
              <Pressable
                key={k}
                onPress={() => press(k)}
                accessibilityRole="button"
                accessibilityLabel={k === '⌫' ? 'Borrar' : k === 'C' ? 'Limpiar' : k}
                style={({ pressed }) => [s.key, pressed && s.keyPressed, (k === 'C' || k === '⌫') && s.keyAlt]}
              >
                {k === '⌫' ? (
                  <Ionicons name="backspace-outline" size={28} color={colors.text} />
                ) : (
                  <Text style={[s.keyText, k === 'C' && { fontSize: 24, color: colors.textMuted }]}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <Button label={confirmLabel} icon="checkmark" size="lg" onPress={submit} loading={saving} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24, flex: 1 },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sideChip: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sideText: { color: colors.textMuted, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  display: {
    borderWidth: 2,
    borderRadius: radius.lg,
    backgroundColor: colors.sheet,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  displayText: { fontFamily: fonts.display, fontSize: 64, lineHeight: 72 },
  displayUnit: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: -6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  key: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 62,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyAlt: { backgroundColor: colors.keyAlt },
  keyPressed: { backgroundColor: colors.keyPressed, transform: [{ scale: 0.97 }] },
  keyText: { color: colors.text, fontFamily: fonts.display, fontSize: 32 },
});
