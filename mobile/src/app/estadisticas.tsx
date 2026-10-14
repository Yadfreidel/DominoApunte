import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { DateFilter, type DateRange } from '@/components/DateFilter';
import { RankingTable } from '@/components/RankingTable';
import { Button, Card, EmptyState, Screen, Stat } from '@/components/ui';
import { computeStats, filterGames } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';

export default function Stats() {
  const { games } = useStore();
  const [range, setRange] = useState<DateRange>({});
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => filterGames(games, range), [games, range]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const finished = filtered.filter((g) => g.status === 'terminada').length;
  const hands = filtered.reduce((n, g) => n + g.hands.length, 0);
  const player = stats.find((p) => p.key === selected);

  return (
    <Screen header={<AppHeader subtitle="Estadísticas" />}>
      {games.length === 0 ? (
        <EmptyState
          icon="stats-chart-outline"
          title="Sin estadísticas todavía"
          message="Termina tu primera partida para ver el ranking de jugadores."
          action={<Button label="Nueva partida" icon="add" onPress={() => router.navigate('/nueva')} />}
        />
      ) : (
        <>
          <Card>
            <DateFilter onChange={setRange} />
          </Card>
          <Card style={s.stats}>
            <Stat label="Partidas" value={filtered.length} />
            <Stat label="Terminadas" value={finished} color={colors.lime} />
            <Stat label="Manos" value={hands} color={colors.purple} />
            <Stat label="Jugadores" value={stats.length} />
          </Card>

          {player ? (
            <Card accent={colors.purple} style={{ gap: space.sm }}>
              <Text style={s.title}>{player.name}</Text>
              <View style={s.stats}>
                <Stat label="Jugadas" value={player.played} />
                <Stat label="Ganadas" value={player.wins} color={colors.lime} />
                <Stat label="Perdidas" value={player.losses} color={colors.danger} />
                <Stat label="% victorias" value={`${player.winRate}%`} color={colors.purple} />
              </View>
              <Text style={s.meta}>
                {player.pending} pendientes · {player.cancelled} canceladas · {player.points} puntos anotados
              </Text>
              <Button label="Cerrar" variant="ghost" size="sm" onPress={() => setSelected(null)} />
            </Card>
          ) : null}

          <Card>
            <Text style={[s.title, { marginBottom: space.sm }]}>Ranking por partidas ganadas</Text>
            {stats.length ? (
              <RankingTable rows={stats} onPressRow={setSelected} />
            ) : (
              <Text style={s.meta}>No hay partidas en este periodo.</Text>
            )}
          </Card>
          <Text style={s.note}>Estadísticas de las partidas guardadas en este dispositivo.</Text>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 14 },
  note: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
});
