import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Button, EmptyState, Screen } from '@/components/ui';
import { STATE_STYLE } from '@/components/challengeStyle';
import { CHALLENGE_STATE_LABEL, challengeProgress, seriesScore } from '@/domain/challenge.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';


/** Retos entre amigos: «primero en ganar N» y series por período. Funcionan sin conexión. */
export default function Challenges() {
  const { challenges, games } = useStore();
  const [openedAt] = useState(() => new Date().toISOString());
  const list = [...challenges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Screen header={<AppHeader subtitle="Retos" />}>
      <Button label="Nuevo reto" icon="add" size="lg" onPress={() => router.push('/retos/nuevo')} />
      {list.length === 0 ? (
        <EmptyState
          icon="flag-outline"
          title="Todavía no hay retos"
          message="Reta a tus amigos: la primera pareja en ganar 3 partidas, o la serie del fin de semana. Cada partida queda también en el historial normal."
        />
      ) : (
        list.map((ch) => {
          const p = challengeProgress(ch, games, openedAt);
          const st = STATE_STYLE[p.state];
          const score = seriesScore(ch, p);
          const winners = p.decided ? p.winnerIds.map((id) => ch.entrants.find((e) => e.id === id)?.name).filter(Boolean) : [];
          return (
            <Pressable
              key={ch.id}
              onPress={() => router.push({ pathname: '/retos/[id]', params: { id: ch.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Reto ${ch.name}, ${CHALLENGE_STATE_LABEL[p.state]}`}
              style={({ pressed }) => [s.card, pressed && { borderColor: colors.purple }]}
            >
              <View style={s.top}>
                <Text style={s.name} numberOfLines={1}>
                  {ch.name}
                </Text>
                <View style={[s.badge, { borderColor: st.color }]}>
                  <Ionicons name={st.icon} size={13} color={st.color} />
                  <Text style={[s.badgeText, { color: st.color }]}>{CHALLENGE_STATE_LABEL[p.state]}</Text>
                </View>
              </View>
              <Text style={s.meta}>
                {ch.kind === 'primero' ? `Primero en ${ch.winsNeeded} victorias` : `Serie ${ch.startsOn} → ${ch.endsOn}`} · {ch.entrants.map((e) => e.name).join(' vs ')}
              </Text>
              {winners.length ? (
                <Text style={[s.meta, { color: colors.warning, fontWeight: '700' }]}>
                  {p.tie ? `Empate: ${winners.join(' y ')}` : `Ganador: ${winners[0]}`}
                </Text>
              ) : score ? (
                <Text style={[s.meta, { color: colors.text }]}>Serie {score}</Text>
              ) : null}
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSoft, padding: space.lg, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, color: colors.text, fontFamily: fonts.heading, fontSize: 21 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 13 },
});
