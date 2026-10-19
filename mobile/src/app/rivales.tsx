import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { formatDateTime } from '@/components/GameSummary';
import { Card, EmptyState, Pill, Screen, Select } from '@/components/ui';
import type { Mode } from '@/domain/game.ts';
import { headToHead, rivalOptions, rivalrySummary } from '@/domain/stats.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

export default function Rivals() {
  const { games, players, tournaments } = useStore();
  const [mode, setMode] = useState<Mode>('individual');
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  const options = useMemo(() => rivalOptions(games, mode, players), [games, mode, players]);
  const labelOf = (key: string) => options.find((o) => o.key === key)?.label ?? '';
  const ready = !!a && !!b && a !== b;
  const result = useMemo(() => (ready ? headToHead(games, mode, a, b) : null), [ready, games, mode, a, b]);
  const rivalry = result ? rivalrySummary(result, labelOf(a), labelOf(b), mode === 'parejas') : null;
  const unit = mode === 'parejas' ? 'pareja' : 'jugador';

  const changeMode = (m: Mode) => {
    setMode(m);
    setA('');
    setB('');
  };

  return (
    <Screen header={<AppHeader subtitle="Historial entre rivales" />}>
      <View style={s.tabs}>
        <Pill label="Individual" active={mode === 'individual'} onPress={() => changeMode('individual')} />
        <Pill label="Por parejas" color={colors.purple} active={mode === 'parejas'} onPress={() => changeMode('parejas')} />
      </View>

      {options.length < 2 ? (
        <EmptyState
          icon="git-compare-outline"
          title="Aún no hay rivales para comparar"
          message={`Se necesitan partidas ${mode === 'parejas' ? 'por parejas' : 'individuales'} terminadas entre al menos dos ${mode === 'parejas' ? 'parejas' : 'jugadores'}.`}
        />
      ) : (
        <>
          <Card style={{ gap: space.md }}>
            <Select
              label={`Primer ${unit}`}
              value={a}
              onChange={setA}
              options={[{ value: '', label: 'Elegir…' }, ...options.map((o) => ({ value: o.key, label: o.label, disabled: o.key === b }))]}
            />
            <Select
              label={`Segundo ${unit}`}
              value={b}
              onChange={setB}
              options={[{ value: '', label: 'Elegir…' }, ...options.map((o) => ({ value: o.key, label: o.label, disabled: o.key === a }))]}
            />
            {mode === 'parejas' ? (
              <Text style={s.muted}>Cada pareja se reconoce por sus dos integrantes, aunque haya jugado con otro nombre de equipo.</Text>
            ) : null}
          </Card>

          {!ready ? (
            <Text style={s.muted}>Elige dos {mode === 'parejas' ? 'parejas' : 'jugadores'} distintos para ver sus enfrentamientos.</Text>
          ) : result && result.encounters.length === 0 ? (
            <EmptyState
              icon="remove-circle-outline"
              title="Sin enfrentamientos"
              message={`${labelOf(a)} y ${labelOf(b)} todavía no se han enfrentado en partidas terminadas de esta modalidad.`}
            />
          ) : result ? (
            <>
              <Card style={s.score}>
                <View style={s.scoreSide}>
                  <Text style={[s.scoreNum, { color: colors.lime }]}>{result.winsA}</Text>
                  <Text style={s.scoreName} numberOfLines={2}>
                    {labelOf(a)}
                  </Text>
                </View>
                <Text style={s.vs}>VS</Text>
                <View style={s.scoreSide}>
                  <Text style={[s.scoreNum, { color: colors.purple }]}>{result.winsB}</Text>
                  <Text style={s.scoreName} numberOfLines={2}>
                    {labelOf(b)}
                  </Text>
                </View>
              </Card>
              {rivalry?.messages.length ? (
                <Card style={{ gap: 6 }}>
                  {rivalry.messages.map((m) => (
                    <View key={m} style={s.msgRow}>
                      <Ionicons name="flame-outline" size={18} color={colors.warning} />
                      <Text style={s.msg}>{m}</Text>
                    </View>
                  ))}
                  {rivalry.recent.length ? (
                    <View style={s.msgRow} accessible accessibilityLabel={`Últimos resultados: ${rivalry.recent.map((w) => (w === 'a' ? labelOf(a) : w === 'b' ? labelOf(b) : 'otro')).join(', ')}`}>
                      <Text style={s.small}>Últimos:</Text>
                      {rivalry.recent.map((w, i) => (
                        <View key={i} style={[s.dot, { backgroundColor: w === 'a' ? colors.lime : w === 'b' ? colors.purple : colors.textDim }]}>
                          <Text style={s.dotText}>{w === 'a' ? '1' : w === 'b' ? '2' : '–'}</Text>
                        </View>
                      ))}
                      <Text style={s.small}>(1: {labelOf(a)} · 2: {labelOf(b)})</Text>
                    </View>
                  ) : null}
                </Card>
              ) : null}
              <Text style={s.muted}>
                {result.encounters.length} {result.encounters.length === 1 ? 'enfrentamiento' : 'enfrentamientos'}
                {result.others ? ` · ${result.others} ganados por otro jugador` : ''}
              </Text>
              <Card style={{ paddingVertical: space.sm }}>
                {result.encounters.map((e, i) => {
                  const tName = e.tournamentId ? tournaments.find((t) => t.id === e.tournamentId)?.name : null;
                  return (
                    <Pressable
                      key={e.gameId}
                      onPress={() => router.push({ pathname: '/historial/[id]', params: { id: e.gameId } })}
                      accessibilityRole="button"
                      accessibilityLabel={`Partida del ${formatDateTime(e.date)}: ${e.scoreA} a ${e.scoreB}`}
                      style={({ pressed }) => [s.row, i < result.encounters.length - 1 && s.rowBorder, pressed && { opacity: 0.7 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.date}>{formatDateTime(e.date)}</Text>
                        <Text style={s.small}>
                          Meta {e.target}
                          {tName ? ` · ${tName}` : ''}
                        </Text>
                      </View>
                      <Text style={s.result}>
                        <Text style={{ color: e.winner === 'a' ? colors.lime : colors.textMuted }}>{e.scoreA}</Text>
                        <Text style={{ color: colors.textDim }}> – </Text>
                        <Text style={{ color: e.winner === 'b' ? colors.purple : colors.textMuted }}>{e.scoreB}</Text>
                      </Text>
                      {e.winner === 'otro' ? <Text style={s.small}>ganó otro</Text> : null}
                      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                    </Pressable>
                  );
                })}
              </Card>
            </>
          ) : null}
        </>
      )}
      <Text style={s.note}>
        Solo cuentan partidas terminadas que no sean de práctica, de la misma modalidad. Las metas pueden variar entre partidas: se
        indican en cada resultado.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.sm },
  muted: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  score: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scoreSide: { flex: 1, alignItems: 'center', gap: 4 },
  scoreNum: { fontFamily: fonts.display, fontSize: 64, lineHeight: 70 },
  scoreName: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  vs: { color: colors.textDim, fontFamily: fonts.black, fontSize: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingHorizontal: 4, borderRadius: radius.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  date: { color: colors.text, fontSize: 15, fontWeight: '600' },
  small: { color: colors.textDim, fontSize: 12 },
  result: { fontFamily: fonts.display, fontSize: 24 },
  note: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  msg: { color: colors.text, fontSize: 15, flex: 1 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotText: { color: colors.onLime, fontSize: 12, fontWeight: '800' },
});
