import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { totals as computeTotals, type Game } from '@/domain/game.ts';
import { colors, radius, sideColor, space } from '@/theme';
import { StatusBadge } from './ui';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const modeLabel = (mode: Game['mode']) => (mode === 'parejas' ? 'Por parejas' : 'Individual');

/** Fila resumida de una partida para listas (historial y administración). */
export function GameSummary({ game, onPress, current }: { game: Game; onPress?: () => void; current?: boolean }) {
  const totals = (game as Game & { totals?: Record<string, number> }).totals ?? computeTotals(game);
  const content = (
    <>
      <View style={s.top}>
        <Text style={s.date}>{formatDateTime(game.createdAt)}</Text>
        <View style={s.badges}>
          {current ? (
            <View style={s.current}>
              <Text style={s.currentText}>En curso</Text>
            </View>
          ) : null}
          <StatusBadge status={game.status} />
        </View>
      </View>
      <Text style={s.meta}>
        {modeLabel(game.mode)} · meta {game.target} · {game.hands.length} {game.hands.length === 1 ? 'mano' : 'manos'}
      </Text>
      <View style={s.sides}>
        {game.sides.map((sd, i) => {
          const won = game.winnerSideId === sd.id;
          return (
            <View key={sd.id} style={s.side}>
              <View style={[s.dot, { backgroundColor: sideColor(i).main }]} />
              <Text style={[s.sideName, won && { color: colors.text, fontWeight: '800' }]} numberOfLines={1}>
                {sd.name}
                {game.mode === 'parejas'
                  ? ` (${sd.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name).join(' y ')})`
                  : ''}
              </Text>
              {won ? <Ionicons name="trophy" size={14} color={colors.warning} /> : null}
              <Text style={[s.sideTotal, { color: sideColor(i).main }]}>{totals[sd.id] ?? 0}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
  if (!onPress) return <View style={s.card}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Partida del ${formatDateTime(game.createdAt)}, ${game.status}`}
      style={({ pressed }) => [s.card, pressed && { borderColor: colors.purple }]}
    >
      {content}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: space.lg,
    gap: 6,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  badges: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  current: { backgroundColor: colors.lime, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  currentText: { color: colors.onLime, fontSize: 12, fontWeight: '800' },
  date: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  meta: { color: colors.textDim, fontSize: 13 },
  sides: { gap: 4, marginTop: 4 },
  side: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 5 },
  sideName: { color: colors.textMuted, fontSize: 15, flex: 1 },
  sideTotal: { fontSize: 17, fontWeight: '800', minWidth: 36, textAlign: 'right' },
});
