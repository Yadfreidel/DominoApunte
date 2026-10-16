import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { DateFilter, type DateRange } from '@/components/DateFilter';
import { Button, Card, EmptyState, Pill, Screen, Stat } from '@/components/ui';
import { filterGames, isCountable, type Mode } from '@/domain/game.ts';
import { computePersonStats, type PersonStats } from '@/domain/stats.ts';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

const fmt = (n: number | null, suffix = '') => (n == null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`);

export default function Stats() {
  const { games, players } = useStore();
  const goTo = useGoTo();
  const [range, setRange] = useState<DateRange>({});
  const [mode, setMode] = useState<Mode>('individual');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => filterGames(games, range), [games, range]);
  const stats = useMemo(() => computePersonStats(filtered, players), [filtered, players]);
  const valid = filtered.filter((g) => isCountable(g) && g.mode === mode);
  const excluded = filtered.filter((g) => g.mode === mode && !isCountable(g)).length;
  const rows = stats[mode];
  const person = rows.find((p) => p.key === selected);
  const avgLabel = 'Prom.';

  return (
    <Screen header={<AppHeader subtitle="Estadísticas" />}>
      {games.length === 0 ? (
        <EmptyState
          icon="stats-chart-outline"
          title="Sin estadísticas todavía"
          message="Termina tu primera partida para ver las estadísticas de cada jugador."
          action={<Button label="Nueva partida" icon="add" onPress={() => goTo('/nueva')} />}
        />
      ) : (
        <>
          <View style={s.tabs} accessibilityRole="tablist">
            {(['individual', 'parejas'] as Mode[]).map((m) => (
              <Pill
                key={m}
                label={m === 'individual' ? 'Individual' : 'Por parejas'}
                active={mode === m}
                color={m === 'individual' ? colors.lime : colors.purple}
                onPress={() => {
                  setMode(m);
                  setSelected(null);
                }}
              />
            ))}
          </View>
          <Card>
            <DateFilter onChange={setRange} />
          </Card>
          <Card style={s.stats}>
            <Stat label="Partidas válidas" value={valid.length} />
            <Stat label="Jugadores" value={rows.length} color={colors.lime} />
            <Stat label="Manos" value={valid.reduce((n, g) => n + g.hands.length, 0)} color={colors.purple} />
          </Card>

          {person ? <PersonCard person={person} mode={mode} onClose={() => setSelected(null)} /> : null}

          {rows.length === 0 ? (
            <EmptyState
              icon="podium-outline"
              title="Sin partidas válidas"
              message={`No hay partidas ${mode === 'parejas' ? 'por parejas' : 'individuales'} terminadas en este periodo.`}
            />
          ) : (
            <Card style={{ paddingHorizontal: space.sm }}>
              <View style={[s.row, s.head]}>
                <Text style={[s.name, s.headText]}>Jugador</Text>
                <Text style={[s.num, s.headText]}>PJ</Text>
                <Text style={[s.num, s.headText]}>G</Text>
                <Text style={[s.num, s.headText]}>P</Text>
                <Text style={[s.pct, s.headText]}>%</Text>
                <Text style={[s.avg, s.headText]} numberOfLines={1}>
                  {avgLabel}
                </Text>
                <Text style={[s.streak, s.headText]}>Racha</Text>
              </View>
              {rows.map((r) => (
                <Pressable
                  key={r.key}
                  onPress={() => setSelected(r.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}: ${r.played} jugadas, ${r.wins} ganadas, ${r.losses} perdidas`}
                  style={({ pressed }) => [s.row, selected === r.key && s.rowActive, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.name} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={s.num}>{r.played}</Text>
                  <Text style={[s.num, { color: colors.lime }]}>{r.wins}</Text>
                  <Text style={[s.num, { color: colors.danger }]}>{r.losses}</Text>
                  <Text style={s.pct}>{fmt(r.winRate, '%')}</Text>
                  <Text style={s.avg}>{fmt(r.avgPoints)}</Text>
                  <Text style={[s.streak, { color: colors.warning }]}>{r.bestStreak}</Text>
                </Pressable>
              ))}
              <Text style={s.legend}>
                PJ: jugadas · G: ganadas · P: perdidas · Prom.: {mode === 'parejas' ? 'puntos de su equipo' : 'puntos'} por partida · Racha: mejor racha de victorias seguidas.
                {mode === 'parejas' ? ' En parejas el resultado cuenta para ambos integrantes y el promedio son los puntos de su equipo.' : ''}
              </Text>
            </Card>
          )}
          <Text style={s.note}>
            Solo cuentan partidas terminadas. No cuentan canceladas, pendientes, de práctica ni pases automáticos de torneo
            {excluded ? ` (${excluded} sin contar en este periodo)` : ''}.
          </Text>
        </>
      )}
    </Screen>
  );
}

function PersonCard({ person, mode, onClose }: { person: PersonStats; mode: Mode; onClose: () => void }) {
  return (
    <Card accent={mode === 'parejas' ? colors.purple : colors.lime} style={{ gap: space.sm }}>
      <View style={s.personHead}>
        <Ionicons name={mode === 'parejas' ? 'people' : 'person'} size={22} color={colors.text} />
        <Text style={s.personName}>{person.name}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={s.stats}>
        <Stat label="Jugadas" value={person.played} />
        <Stat label="Ganadas" value={person.wins} color={colors.lime} />
        <Stat label="Perdidas" value={person.losses} color={colors.danger} />
        <Stat label="% victorias" value={fmt(person.winRate, '%')} color={colors.purple} />
        <Stat
          label={mode === 'parejas' ? 'Promedio de puntos de su equipo por partida' : 'Promedio de puntos por partida'}
          value={fmt(person.avgPoints)}
        />
        <Stat label="Mejor racha" value={person.bestStreak} color={colors.warning} />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.sm },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    gap: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    borderRadius: radius.sm,
  },
  rowActive: { backgroundColor: colors.limeSoft },
  head: { minHeight: 34 },
  headText: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  num: { width: 34, textAlign: 'center', color: colors.text, fontSize: 15, fontWeight: '700' },
  pct: { width: 46, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '700' },
  avg: { width: 50, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '700' },
  streak: { width: 46, textAlign: 'center', color: colors.text, fontSize: 15, fontWeight: '700' },
  legend: { color: colors.textDim, fontSize: 12, marginTop: space.sm, paddingHorizontal: 6 },
  note: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  personName: { flex: 1, color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
});
