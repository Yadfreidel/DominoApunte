import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { DateFilter, type DateRange } from '@/components/DateFilter';
import { GameSummary } from '@/components/GameSummary';
import { Button, Card, EmptyState, Label, Pill, Screen, Select } from '@/components/ui';
import { filterGames, nameKey, type GameStatus } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';

const STATUS_FILTERS: { value: GameStatus | 'todas'; label: string; color: string }[] = [
  { value: 'todas', label: 'Todas', color: colors.lime },
  { value: 'pendiente', label: 'Pendientes', color: colors.warning },
  { value: 'terminada', label: 'Terminadas', color: colors.success },
  { value: 'cancelada', label: 'Canceladas', color: colors.danger },
];

export default function History() {
  const { games, currentGame } = useStore();
  const [range, setRange] = useState<DateRange>({});
  const [player, setPlayer] = useState('');
  const [status, setStatus] = useState<GameStatus | 'todas'>('todas');

  const players = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of games) for (const p of g.participants) map.set(nameKey(p.name), p.name);
    return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'));
  }, [games]);

  const filtered = useMemo(
    () => filterGames(games, { ...range, player: player || undefined, status }),
    [games, range, player, status],
  );

  const counts = useMemo(() => {
    const c = { pendiente: 0, terminada: 0, cancelada: 0 };
    for (const g of filtered) c[g.status] += 1;
    return c;
  }, [filtered]);

  return (
    <Screen header={<AppHeader subtitle="Historial" />}>
      {games.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="Todavía no hay partidas"
          message="Las partidas que juegues aparecerán aquí con todas sus manos."
          action={<Button label="Nueva partida" icon="add" onPress={() => router.navigate('/nueva')} />}
        />
      ) : (
        <>
          <Card style={{ gap: space.lg }}>
            <DateFilter onChange={setRange} />
            <Select
              label="Jugador"
              value={player}
              onChange={setPlayer}
              options={[{ value: '', label: 'Todos los jugadores' }, ...players.map((p) => ({ value: p, label: p }))]}
            />
            <View style={{ gap: space.sm }}>
              <Label>Estado</Label>
              <View style={s.row}>
                {STATUS_FILTERS.map((f) => (
                  <Pill key={f.value} label={f.label} color={f.color} active={status === f.value} onPress={() => setStatus(f.value)} />
                ))}
              </View>
            </View>
          </Card>

          <Text style={s.count}>
            {filtered.length} {filtered.length === 1 ? 'partida' : 'partidas'} · {counts.terminada} terminadas ·{' '}
            {counts.pendiente} pendientes · {counts.cancelada} canceladas
          </Text>

          {filtered.length === 0 ? (
            <EmptyState icon="search-outline" title="Sin resultados" message="No hay partidas con esos filtros. Prueba con otro rango o jugador." />
          ) : (
            filtered.map((g) => (
              <GameSummary
                key={g.id}
                game={g}
                current={currentGame?.id === g.id && g.status === 'pendiente'}
                onPress={() => router.navigate({ pathname: '/historial/[id]', params: { id: g.id } })}
              />
            ))
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  count: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
