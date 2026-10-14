import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime, modeLabel } from '@/components/GameSummary';
import { HandLedger, ScoreCard } from '@/components/Score';
import { Button, Card, EmptyState, Screen, StatusBadge } from '@/components/ui';
import { sideLabel, totals as computeTotals } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';
import { goBackOr } from '@/navigation';

/** Detalle de una partida anterior. Es de solo lectura: aquí no se pueden modificar resultados. */
export default function HistoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const { toast } = useDialogs();
  const game = store.games.find((g) => g.id === id);

  if (!game) {
    return (
      <Screen header={<AppHeader subtitle="Historial" />}>
        <EmptyState
          icon="alert-circle-outline"
          title="Partida no encontrada"
          message="Puede que haya sido eliminada por un administrador."
          action={<Button label="Volver al historial" variant="outline" onPress={() => goBackOr('/historial')} />}
        />
      </Screen>
    );
  }

  const totals = computeTotals(game);
  const isCurrent = store.currentGame?.id === game.id;
  const winner = game.sides.find((sd) => sd.id === game.winnerSideId);

  const resume = async () => {
    await store.resumeGame(game.id);
    router.dismissTo('/partida');
  };

  const rematch = async () => {
    try {
      await store.rematch(game.id);
      toast('¡Revancha! Marcadores en cero.');
      router.dismissTo('/partida');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo crear la revancha.', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Detalle de partida" />}>
      <Button label="Volver al historial" icon="arrow-back" variant="ghost" size="sm" onPress={() => goBackOr('/historial')} style={{ alignSelf: 'flex-start' }} />

      <Card style={{ gap: 6 }}>
        <View style={s.rowBetween}>
          <Text style={s.date}>{formatDateTime(game.createdAt)}</Text>
          <StatusBadge status={game.status} />
        </View>
        <Text style={s.meta}>
          {modeLabel(game.mode)} · meta {game.target} puntos · {game.hands.length} manos
        </Text>
        {game.finishedAt ? <Text style={s.meta}>Terminó: {formatDateTime(game.finishedAt)}</Text> : null}
        <Text style={s.meta}>Participantes: {game.participants.map((p) => p.name).join(', ')}</Text>
        {winner ? (
          <View style={s.winnerRow}>
            <Ionicons name="trophy" size={18} color={colors.warning} />
            <Text style={s.winner}>
              Ganó {winner.name}
              {game.mode === 'parejas' ? ` (${sideLabel(game, winner)})` : ''}
            </Text>
          </View>
        ) : null}
        {game.adminLocked ? <Text style={s.admin}>Corregida por un administrador.</Text> : null}
      </Card>

      <View style={[s.cards, game.sides.length > 2 && { flexWrap: 'wrap' }]}>
        {game.sides.map((sd, i) => (
          <View key={sd.id} style={game.sides.length > 2 ? { flexBasis: '47%', flexGrow: 1 } : { flex: 1 }}>
            <ScoreCard
              name={sd.name}
              members={sd.participantIds.map((pid) => game.participants.find((p) => p.id === pid)?.name ?? '').filter(Boolean)}
              total={totals[sd.id]}
              target={game.target}
              index={i}
              team={game.mode === 'parejas'}
              winner={game.winnerSideId === sd.id}
              compact
            />
          </View>
        ))}
      </View>

      <Card style={{ gap: space.sm }}>
        <View style={s.rowBetween}>
          <Text style={s.title}>Detalle de manos</Text>
          <View style={s.lock}>
            <Ionicons name="lock-closed" size={13} color={colors.textDim} />
            <Text style={s.lockText}>Solo lectura</Text>
          </View>
        </View>
        <HandLedger game={game} />
      </Card>

      {game.status === 'pendiente' ? (
        <Button label={isCurrent ? 'Ir a la partida en curso' : 'Continuar esta partida'} icon="play" onPress={resume} />
      ) : null}
      {game.status === 'terminada' ? <Button label="Jugar revancha" icon="refresh" variant="outline" onPress={rematch} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  date: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  meta: { color: colors.textMuted, fontSize: 14 },
  winnerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  winner: { color: colors.text, fontSize: 16, fontWeight: '700' },
  admin: { color: colors.purple, fontSize: 13 },
  cards: { flexDirection: 'row', gap: space.md },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lockText: { color: colors.textDim, fontSize: 12 },
});
