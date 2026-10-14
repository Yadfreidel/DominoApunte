import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FormModal } from '@/components/admin/FormModal';
import { CorrectionList } from '@/components/admin/sections';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime, modeLabel } from '@/components/GameSummary';
import { ScoreCard } from '@/components/Score';
import { Button, Card, EmptyState, Loading, Screen, StatusBadge } from '@/components/ui';
import { MAX_HAND_POINTS, parsePoints, runningTotals, sideLabel, type Hand } from '@/domain/game.ts';
import type { Correction, ServerGame } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, sideColor, space } from '@/theme';
import { goBackOr } from '@/navigation';

export default function AdminGameDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ game: ServerGame; corrections: Correction[] }>(`/admin/games/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState<{ hand: Hand; number: number } | null>(null);

  const back = () => goBackOr({ pathname: '/admin', params: { seccion: 'partidas' } });

  if (q.loading && !q.data) {
    return (
      <Screen header={<AppHeader subtitle="Administración" />}>
        <Loading />
      </Screen>
    );
  }
  if (q.error || !q.data) {
    return (
      <Screen header={<AppHeader subtitle="Administración" />}>
        <EmptyState
          icon="alert-circle-outline"
          title="No se pudo abrir la partida"
          message={q.error ?? 'La partida no existe.'}
          action={<Button label="Volver a partidas" variant="outline" onPress={back} />}
        />
      </Screen>
    );
  }

  const { game, corrections } = q.data;
  const running = runningTotals(game);
  const sideIndex = new Map(game.sides.map((sd, i) => [sd.id, i]));

  const afterChange = (updated?: ServerGame) => {
    if (updated) q.setData({ game: updated, corrections });
    void q.reload();
    void syncNow();
  };

  const deleteHand = async (hand: Hand, number: number) => {
    const side = game.sides[sideIndex.get(hand.sideId) ?? 0];
    const reason = await askReason({
      title: `¿Eliminar la mano ${number}?`,
      message: `${side.name} +${hand.points}. Se recalculará el marcador y el ganador. No se puede deshacer.`,
      confirmLabel: 'Eliminar mano',
      destructive: true,
    });
    if (!reason) return;
    try {
      const res = await api<{ game: ServerGame }>(`/admin/games/${game.id}/hands/${hand.id}`, { method: 'DELETE', body: { reason } });
      toast('Mano eliminada y marcador recalculado');
      afterChange(res.game);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const changeStatus = async (status: 'cancelada' | 'pendiente') => {
    const reason = await askReason({
      title: status === 'cancelada' ? '¿Cancelar esta partida?' : '¿Reabrir esta partida?',
      message:
        status === 'cancelada'
          ? 'Dejará de contar para el ranking.'
          : 'Se recalcula el estado: si alguien ya alcanzó la meta, quedará terminada.',
      confirmLabel: status === 'cancelada' ? 'Cancelar partida' : 'Reabrir',
      destructive: status === 'cancelada',
    });
    if (!reason) return;
    try {
      const res = await api<{ game: ServerGame }>(`/admin/games/${game.id}`, { method: 'PATCH', body: { status, reason } });
      toast(status === 'cancelada' ? 'Partida cancelada' : 'Partida reabierta');
      afterChange(res.game);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const deleteGame = async () => {
    const reason = await askReason({
      title: '¿Eliminar la partida definitivamente?',
      message: 'Se borrarán la partida y todas sus manos. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar partida',
      destructive: true,
    });
    if (!reason) return;
    try {
      await api(`/admin/games/${game.id}`, { method: 'DELETE', body: { reason } });
      toast('Partida eliminada');
      void syncNow();
      back();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Administración · Partida" />} maxWidth={900}>
      <Button label="Volver a partidas" icon="arrow-back" variant="ghost" size="sm" onPress={back} style={{ alignSelf: 'flex-start' }} />

      <Card style={{ gap: 6 }}>
        <View style={s.rowBetween}>
          <Text style={s.title}>{formatDateTime(game.createdAt)}</Text>
          <StatusBadge status={game.status} />
        </View>
        <Text style={s.muted}>
          {modeLabel(game.mode)} · meta {game.target} · {game.hands.length} manos · revisión {game.revision}
        </Text>
        <Text style={s.muted}>Participantes: {game.participants.map((p) => p.name).join(', ')}</Text>
        {game.finishedAt ? <Text style={s.muted}>Terminó: {formatDateTime(game.finishedAt)}</Text> : null}
        <Text style={s.id}>ID: {game.id}</Text>
      </Card>

      <View style={[s.cards, game.sides.length > 2 && { flexWrap: 'wrap' }]}>
        {game.sides.map((sd, i) => (
          <View key={sd.id} style={game.sides.length > 2 ? { flexBasis: '47%', flexGrow: 1 } : { flex: 1 }}>
            <ScoreCard
              name={sd.name}
              members={sd.participantIds.map((pid) => game.participants.find((p) => p.id === pid)?.name ?? '').filter(Boolean)}
              detail={game.mode === 'parejas' ? sideLabel(game, sd) : undefined}
              total={game.totals[sd.id] ?? 0}
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
        <Text style={s.cardTitle}>Historial de manos</Text>
        {game.hands.length === 0 ? <Text style={s.muted}>Sin manos registradas.</Text> : null}
        {game.hands.map((h, i) => {
          const idx = sideIndex.get(h.sideId) ?? 0;
          const c = sideColor(idx);
          return (
            <View key={h.id} style={[s.handRow, i < game.hands.length - 1 && s.border]}>
              <View style={[s.dot, { backgroundColor: c.main }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.handTitle}>
                  Mano {i + 1} · <Text style={{ color: c.main }}>{game.sides[idx]?.name} +{h.points}</Text>
                </Text>
                <Text style={s.small}>
                  {formatDateTime(h.createdAt)}
                  {h.editedAt ? ` · editada ${formatDateTime(h.editedAt)}` : ''} · acumulado{' '}
                  {game.sides.map((sd) => running[i][sd.id]).join(' - ')}
                </Text>
              </View>
              <Pressable
                onPress={() => setEditing({ hand: h, number: i + 1 })}
                accessibilityRole="button"
                accessibilityLabel={`Corregir mano ${i + 1}`}
                style={s.action}
              >
                <Ionicons name="create-outline" size={22} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => deleteHand(h, i + 1)}
                accessibilityRole="button"
                accessibilityLabel={`Eliminar mano ${i + 1}`}
                style={s.action}
              >
                <Ionicons name="trash-outline" size={22} color={colors.danger} />
              </Pressable>
            </View>
          );
        })}
      </Card>

      <View style={s.actions}>
        {game.status !== 'cancelada' ? (
          <Button label="Cancelar partida" icon="close-circle-outline" variant="outline" onPress={() => changeStatus('cancelada')} style={s.flex} />
        ) : (
          <Button label="Reabrir partida" icon="refresh" variant="outline" onPress={() => changeStatus('pendiente')} style={s.flex} />
        )}
        <Button label="Eliminar partida" icon="trash-outline" variant="danger" onPress={deleteGame} style={s.flex} />
      </View>

      <Card style={{ gap: space.sm }}>
        <Text style={s.cardTitle}>Correcciones de esta partida</Text>
        <CorrectionList corrections={corrections} />
      </Card>

      <FormModal
        visible={!!editing}
        title={`Corregir mano ${editing?.number ?? ''}`}
        description={
          editing
            ? `${game.sides[sideIndex.get(editing.hand.sideId) ?? 0]?.name}: ${editing.hand.points} puntos actualmente. Se recalcularán el marcador y el ganador.`
            : undefined
        }
        fields={[
          { key: 'points', label: `Puntos correctos (0 a ${MAX_HAND_POINTS})`, numeric: true, initial: editing ? String(editing.hand.points) : '' },
          { key: 'reason', label: 'Motivo de la corrección', multiline: true, placeholder: 'Ej.: se anotó 45 en lugar de 5' },
        ]}
        submitLabel="Guardar corrección"
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const parsed = parsePoints(v.points ?? '');
          if (!parsed.ok) throw new Error(parsed.error);
          if ((v.reason ?? '').trim().length < 3) throw new Error('Escribe el motivo (mínimo 3 caracteres).');
          const res = await api<{ game: ServerGame }>(`/admin/games/${game.id}/hands/${editing!.hand.id}`, {
            method: 'PATCH',
            body: { points: parsed.value, reason: v.reason },
          });
          setEditing(null);
          toast('Corrección guardada y registrada');
          afterChange(res.game);
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { color: colors.text, fontSize: 19, fontWeight: '700', flexShrink: 1 },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 14 },
  id: { color: colors.textDim, fontSize: 12 },
  cards: { flexDirection: 'row', gap: space.md },
  handRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  dot: { width: 10, height: 10, borderRadius: 5 },
  handTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  small: { color: colors.textDim, fontSize: 12 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  flex: { flexGrow: 1, flexBasis: 200 },
});
