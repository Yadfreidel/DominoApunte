import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Game } from '@/domain/game.ts';
import { buildSummarySvg } from '@/domain/summary.ts';
import { buildWinnerCardSvg } from '@/domain/winnerCard.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';
import { useDialogs } from './Dialogs';
import { SummaryImage } from './SummaryImage';

/**
 * Ventana con la vista previa para compartir: el resumen de la partida o la tarjeta del ganador.
 * Siempre se genera desde la partida guardada, aunque el marcador ya se haya reiniciado.
 * No se envía nada sin que el usuario pulse compartir o descargar.
 */
export function SummaryShare({
  game,
  context,
  kind = 'resumen',
  streak,
  onClose,
}: {
  game: Game;
  context?: string;
  kind?: 'resumen' | 'victoria';
  /** Racha calculada del ganador (solo la tarjeta del ganador la muestra). */
  streak?: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { toast } = useDialogs();
  const { branding, photoOf } = useStore();
  const victory = kind === 'victoria';
  const { svg, width, height } = useMemo(
    () =>
      (victory ? buildWinnerCardSvg(game, { appName: branding.appName, logo: branding.logo, photoOf, streak }) : null) ??
      buildSummarySvg(game, { context, appName: branding.appName }),
    // photoOf cambia con cada render del almacén; las fotos se leen al abrir la ventana.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, context, branding.appName, branding.logo, victory, streak],
  );
  const date = (game.finishedAt ?? game.createdAt).slice(0, 10);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={s.header}>
            <Text style={s.title}>{victory ? 'Compartir victoria' : 'Compartir resumen'}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.md }}>
            <SummaryImage
              svg={svg}
              width={width}
              height={height}
              fileName={`domino-${victory ? 'victoria' : 'resumen'}-${date}.png`}
              title={victory ? 'Tarjeta del ganador' : 'Resumen de la partida'}
              onDone={(r) => toast(r === 'descargada' ? 'Imagen descargada' : victory ? 'Victoria compartida' : 'Resumen compartido')}
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
