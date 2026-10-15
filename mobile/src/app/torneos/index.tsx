import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { formatDateTime } from '@/components/GameSummary';
import { Button, EmptyState, Screen } from '@/components/ui';
import { resolveTournament } from '@/domain/tournament.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

const STATUS = {
  en_curso: { label: 'En curso', color: colors.warning, icon: 'time-outline' },
  terminado: { label: 'Terminado', color: colors.success, icon: 'trophy-outline' },
  cancelado: { label: 'Cancelado', color: colors.danger, icon: 'close-circle-outline' },
} as const;

export default function Tournaments() {
  const { tournaments, games } = useStore();
  const list = useMemo(
    () => tournaments.map((t) => resolveTournament(t, games)).sort((a, b) => b.tournament.createdAt.localeCompare(a.tournament.createdAt)),
    [tournaments, games],
  );

  return (
    <Screen header={<AppHeader subtitle="Torneos" />}>
      <Button label="Nuevo torneo" icon="add" size="lg" onPress={() => router.push('/torneos/nuevo')} />
      {list.length === 0 ? (
        <EmptyState
          icon="trophy-outline"
          title="Todavía no hay torneos"
          message="Crea un torneo de eliminación directa, individual o por parejas, y sigue el cuadro hasta la final."
        />
      ) : (
        list.map((r) => {
          const st = STATUS[r.status];
          const t = r.tournament;
          return (
            <Pressable
              key={t.id}
              onPress={() => router.push({ pathname: '/torneos/[id]', params: { id: t.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Torneo ${t.name}, ${st.label}`}
              style={({ pressed }) => [s.card, pressed && { borderColor: colors.purple }]}
            >
              <View style={s.top}>
                <Text style={s.name} numberOfLines={1}>
                  {t.name}
                </Text>
                <View style={[s.badge, { borderColor: st.color }]}>
                  <Ionicons name={st.icon} size={13} color={st.color} />
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
              <Text style={s.meta}>
                {t.mode === 'parejas' ? 'Por parejas' : 'Individual'} · {t.entrants.length} {t.mode === 'parejas' ? 'parejas' : 'jugadores'} · meta{' '}
                {t.target} · {formatDateTime(t.createdAt)}
              </Text>
              {r.champion ? (
                <View style={s.champ}>
                  <Ionicons name="trophy" size={16} color={colors.warning} />
                  <Text style={s.champText}>Campeón: {r.champion.name}</Text>
                </View>
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
  champ: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  champText: { color: colors.warning, fontWeight: '700', fontSize: 15 },
});
