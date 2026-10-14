import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@/theme';

export interface RankingRow {
  key: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  points?: number;
}

const MEDALS = ['#FFD24A', '#C9D3E6', '#E39B5B'];

/** Ranking ordenado por partidas ganadas, con victorias, derrotas y porcentaje. */
export function RankingTable({ rows, onPressRow }: { rows: RankingRow[]; onPressRow?: (key: string) => void }) {
  return (
    <View>
      <View style={[s.row, s.head]}>
        <Text style={[s.pos, s.headText]}>#</Text>
        <Text style={[s.name, s.headText]}>Jugador</Text>
        <Text style={[s.num, s.headText]}>PJ</Text>
        <Text style={[s.num, s.headText]}>G</Text>
        <Text style={[s.num, s.headText]}>P</Text>
        <Text style={[s.pct, s.headText]}>% vict.</Text>
      </View>
      {rows.map((r, i) => {
        const content = (
          <>
            <View style={s.pos}>
              {i < 3 && r.wins > 0 ? (
                <Ionicons name="medal" size={18} color={MEDALS[i]} />
              ) : (
                <Text style={s.posText}>{i + 1}</Text>
              )}
            </View>
            <Text style={s.name} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={s.num}>{r.played}</Text>
            <Text style={[s.num, { color: colors.lime }]}>{r.wins}</Text>
            <Text style={[s.num, { color: colors.danger }]}>{r.losses}</Text>
            <View style={s.pct}>
              <Text style={s.pctText}>{r.winRate.toFixed(r.winRate % 1 ? 1 : 0)}%</Text>
              <View style={s.bar}>
                <View style={[s.barFill, { width: `${Math.min(100, r.winRate)}%` }]} />
              </View>
            </View>
          </>
        );
        return onPressRow ? (
          <Pressable
            key={r.key}
            onPress={() => onPressRow(r.key)}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${r.name}: ${r.wins} victorias, ${r.losses} derrotas, ${r.winRate}%`}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: 'rgba(255,255,255,0.04)' }]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={r.key} style={s.row} accessible accessibilityLabel={`${i + 1}. ${r.name}: ${r.wins} victorias, ${r.losses} derrotas`}>
            {content}
          </View>
        );
      })}
      <Text style={s.legend}>PJ: partidas jugadas · G: ganadas · P: perdidas. El % se calcula sobre partidas terminadas.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    gap: 6,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  head: { minHeight: 34 },
  headText: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  pos: { width: 28, alignItems: 'center' },
  posText: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
  num: { width: 34, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '700' },
  pct: { width: 72, alignItems: 'flex-end', gap: 3 },
  pctText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  bar: { width: 60, height: 4, borderRadius: 2, backgroundColor: 'rgba(160,107,255,0.2)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.purple },
  legend: { color: colors.textDim, fontSize: 12, marginTop: space.sm },
});
