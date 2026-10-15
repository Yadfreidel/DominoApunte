import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Game } from '@/domain/game.ts';
import { buildSummarySvg } from '@/domain/summary.ts';
import { colors, fonts, space } from '@/theme';
import { useDialogs } from './Dialogs';
import { SummaryImage } from './SummaryImage';

/** Ventana con la vista previa del resumen de la partida y las opciones para compartirlo. */
export function SummaryShare({ game, context, onClose }: { game: Game; context?: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { toast } = useDialogs();
  const { svg, width, height } = useMemo(() => buildSummarySvg(game, { context }), [game, context]);
  const date = (game.finishedAt ?? game.createdAt).slice(0, 10);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={s.header}>
            <Text style={s.title}>Compartir resumen</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.md }}>
            <SummaryImage
              svg={svg}
              width={width}
              height={height}
              fileName={`domino-resumen-${date}.png`}
              title="Resumen de la partida"
              onDone={(r) => toast(r === 'descargada' ? 'Imagen descargada' : 'Resumen compartido')}
            />
          </ScrollView>
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
    maxWidth: 560,
    maxHeight: '94%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24 },
});
