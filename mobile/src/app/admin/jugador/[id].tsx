import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { Avatar } from '@/components/Avatar';
import { formatDateTime, GameSummary } from '@/components/GameSummary';
import { Button, Card, EmptyState, Loading, Screen, Stat } from '@/components/ui';
import type { PlayerRow, ServerGame } from '@/services/api';
import { colors, space } from '@/theme';
import { goBackOr } from '@/navigation';

export default function AdminPlayerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAdminQuery<{ player: PlayerRow; games: ServerGame[]; aliases: string[] }>(`/admin/players/${encodeURIComponent(id)}`);
  const back = () => goBackOr({ pathname: '/admin', params: { seccion: 'jugadores' } });

  return (
    <Screen header={<AppHeader subtitle="Administración · Jugador" />} maxWidth={900}>
      <Button label="Volver a jugadores" icon="arrow-back" variant="ghost" size="sm" onPress={back} style={{ alignSelf: 'flex-start' }} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? (
        <EmptyState icon="alert-circle-outline" title="No se pudo cargar" message={q.error} action={<Button label="Reintentar" variant="outline" onPress={q.reload} />} />
      ) : null}
      {q.data ? (
        <>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Avatar name={q.data.player.name} colorIndex={0} size={64} photo={q.data.player.photo ?? undefined} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{q.data.player.name}</Text>
                <Text style={s.muted}>
                  {q.data.player.deletedAt ? 'En la papelera' : q.data.player.active ? 'Activo' : 'Inactivo'} · registrado {formatDateTime(q.data.player.createdAt)}
                </Text>
                <Text style={s.muted}>
                  {q.data.player.account
                    ? `Cuenta de acceso: ${q.data.player.account.username}${q.data.player.account.active ? '' : ' (bloqueada)'}`
                    : 'Sin cuenta de acceso'}
                  {q.data.aliases.length ? ` · nombres anteriores: ${q.data.aliases.join(', ')}` : ''}
                </Text>
              </View>
            </View>
            <View style={s.stats}>
              <Stat label="Partidas oficiales" value={q.data.player.played} />
              <Stat label="Ganadas" value={q.data.player.wins} color={colors.lime} />
              <Stat label="Perdidas" value={q.data.player.losses} color={colors.danger} />
              <Stat label="% victorias" value={`${q.data.player.winRate}%`} color={colors.purple} />
              <Stat label="Pendientes" value={q.data.player.pending} color={colors.warning} />
              <Stat label="Puntos" value={q.data.player.points} />
            </View>
          </Card>
          <Text style={s.section}>Partidas</Text>
          {q.data.games.length ? (
            q.data.games.map((g) => (
              <GameSummary key={g.id} game={g} onPress={() => router.push({ pathname: '/admin/partida/[id]', params: { id: g.id } })} />
            ))
          ) : (
            <EmptyState icon="grid-outline" title="Sin partidas" message="Este jugador aún no tiene partidas registradas." />
          )}
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  name: { color: colors.text, fontSize: 28, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 14 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  section: { color: colors.text, fontSize: 19, fontWeight: '700' },
});
