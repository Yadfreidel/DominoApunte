import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FormModal } from '@/components/admin/FormModal';
import { AuditList, openTournament } from '@/components/admin/common';
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
  const q = useAdminQuery<{ game: ServerGame; corrections: Correction[]; tournament: { id: string; name: string } | null }>(
    `/admin/games/${encodeURIComponent(id)}`,
  );
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

  const { game, corrections, tournament } = q.data;
  const trashed = !!game.deletedAt;
  const running = runningTotals(game);
  const sideIndex = new Map(game.sides.map((sd, i) => [sd.id, i]));

  const afterChange = (updated?: ServerGame) => {
    if (updated) q.setData({ game: updated, corrections, tournament });
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

  const trashGame = async () => {
    const reason = await askReason({
      title: '¿Enviar la partida a la papelera?',
      message: 'Deja de contar en estadísticas y ranking, y el dispositivo que la registró la retira al sincronizar. Se puede restaurar desde la Papelera.',
      confirmLabel: 'Enviar a la papelera',
      destructive: true,
    });
    if (!reason) return;
    try {
      await api(`/admin/games/${game.id}`, { method: 'DELETE', body: { reason } });
      toast('Partida en la papelera');
      void syncNow();
      back();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const togglePractice = async () => {
    const reason = await askReason({
      title: game.practice ? '¿Marcar como partida oficial?' : '¿Marcar como partida de prueba?',
      message: game.practice ? 'Volverá a contar en estadísticas y ranking.' : 'Dejará de contar en estadísticas y ranking. Podrás limpiarla desde «Pruebas».',
      confirmLabel: game.practice ? 'Marcar oficial' : 'Marcar prueba',
    });
    if (!reason) return;
    try {
      const res = await api<{ game: ServerGame }>(`/admin/games/${game.id}`, { method: 'PATCH', body: { practice: !game.practice, reason } });
      toast(game.practice ? 'Partida oficial' : 'Partida marcada como prueba');
      afterChange(res.game);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const restore = async () => {
    const reason = await askReason({ title: '¿Restaurar la partida?', confirmLabel: 'Restaurar' });
    if (!reason) return;
    try {
      const res = await api<{ game: ServerGame }>(`/admin/trash/games/${game.id}/restore`, { method: 'POST', body: { reason } });
      toast('Partida restaurada');
      afterChange(res.game);
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
        {game.practice ? <Text style={[s.muted, { color: colors.info, fontWeight: '700' }]}>Partida de prueba: no cuenta en estadísticas.</Text> : null}
        {game.rules?.passPoints ? <Text style={s.muted}>Regla elegida: {game.rules.passPoints} puntos por pase</Text> : null}
        {tournament ? (
          <Text style={[s.muted, { color: colors.purple, fontWeight: '700' }]} onPress={() => openTournament(tournament.id)} accessibilityRole="link">
            Torneo: {tournament.name}
          </Text>
        ) : null}
        <Text style={s.id}>ID: {game.id}</Text>
      </Card>

      {trashed ? (
        <Card accent={colors.danger} style={{ gap: space.sm }}>
          <Text style={[s.cardTitle, { color: colors.danger }]}>En la papelera desde {formatDateTime(game.deletedAt)}</Text>
          <Text style={s.muted}>No cuenta en estadísticas. Restáurala para poder corregirla.</Text>
          <Button label="Restaurar partida" icon="arrow-undo-outline" onPress={restore} />
        </Card>
      ) : null}

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
              {trashed ? null : (
              <>
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
              </>
              )}
            </View>
          );
        })}
      </Card>

      {trashed ? null : (
      <View style={s.actions}>
        {game.status !== 'cancelada' ? (
          <Button label="Cancelar partida" icon="close-circle-outline" variant="outline" onPress={() => changeStatus('cancelada')} style={s.flex} />
        ) : (
          <Button label="Reabrir partida" icon="refresh" variant="outline" onPress={() => changeStatus('pendiente')} style={s.flex} />
        )}
        <Button label={game.practice ? 'Marcar como oficial' : 'Marcar como prueba'} icon="flask-outline" variant="outline" onPress={togglePractice} style={s.flex} />
        <Button label="Enviar a la papelera" icon="trash-outline" variant="danger" onPress={trashGame} style={s.flex} />
      </View>
      )}

      <Card style={{ gap: space.sm }}>
        <Text style={s.cardTitle}>Cambios administrativos de esta partida</Text>
        <AuditList corrections={corrections} />
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
