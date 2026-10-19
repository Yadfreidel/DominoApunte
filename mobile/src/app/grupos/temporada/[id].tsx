import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime, GameSummary } from '@/components/GameSummary';
import { Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { SEASON_STATUS_LABEL, seasonRulesText, type GroupGame, type GroupRole, type SeasonInfo, type Standings } from '@/domain/groups.ts';
import { goBackOr } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

interface SeasonDetail {
  season: SeasonInfo & { final: { champions: { name: string }[]; revisions: { at: string; reason: string; champions: { name: string }[] }[] } | null; cancelledAt: string | null };
  group: { id: string; name: string; myRole: GroupRole };
  standings: Standings;
  games: GroupGame[];
}

export default function SeasonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const { confirm, toast } = useDialogs();
  const q = useAdminQuery<SeasonDetail>(store.user ? `/seasons/${encodeURIComponent(id)}` : null);
  const [openedAt] = useState(() => Date.now());

  if (!q.data) {
    return (
      <Screen header={<AppHeader subtitle="Temporada" />}>
        {q.loading || !store.user ? <Loading /> : <EmptyState icon="alert-circle-outline" title="No se pudo abrir la temporada" message={q.error ?? ''} />}
      </Screen>
    );
  }
  const { season, group, standings, games } = q.data;
  const canManage = group.myRole !== 'miembro';
  const finished = season.status === 'finalizada';
  const champions = finished ? (season.final?.champions ?? standings.champions) : [];
  const total = Math.max(1, (Date.parse(season.endsOn) - Date.parse(season.startsOn)) / 86400_000 + 1);
  const elapsed = Math.min(total, Math.max(0, (openedAt - Date.parse(season.startsOn)) / 86400_000));

  const cancel = async () => {
    const ok = await confirm({ title: `¿Cancelar ${season.name}?`, message: 'No se incorporarán más partidas y no habrá campeón. Las partidas se conservan.', confirmLabel: 'Cancelar temporada', destructive: true });
    if (!ok) return;
    try {
      await store.api(`/seasons/${season.id}`, { method: 'PATCH', body: { cancel: true } });
      toast('Temporada cancelada', 'info');
      q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cancelar.', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Temporada" />}>
      <Button label={group.name} icon="arrow-back" variant="ghost" size="sm" onPress={() => goBackOr({ pathname: '/grupos/[id]', params: { id: group.id } })} style={{ alignSelf: 'flex-start' }} />
      <Card style={{ gap: 6 }}>
        <Text style={s.title}>{season.name}</Text>
        <Text style={[s.meta, { color: season.status === 'activa' ? colors.lime : colors.textMuted }]}>{SEASON_STATUS_LABEL[season.status]}</Text>
        {season.status === 'activa' ? (
          <View style={s.bar} accessibilityLabel={`Progreso: día ${Math.ceil(elapsed)} de ${total}`}>
            <View style={[s.fill, { width: `${(elapsed / total) * 100}%` }]} />
          </View>
        ) : null}
        <Text style={s.meta}>
          {standings.games} {standings.games === 1 ? 'partida válida' : 'partidas válidas'}
        </Text>
      </Card>

      {champions.length ? (
        <Card accent={colors.warning} style={s.champion}>
          <Ionicons name="trophy" size={44} color={colors.warning} />
          <Text style={s.championLabel}>{champions.length > 1 ? 'CAMPEONES (EMPATE)' : 'CAMPEÓN'}</Text>
          <Text style={s.championName}>{champions.map((c) => c.name).join(' · ')}</Text>
        </Card>
      ) : null}

      <Text style={s.subTitle}>Clasificación</Text>
      {standings.rows.length === 0 ? (
        <EmptyState icon="podium-outline" title="Sin partidas todavía" message="Asocia partidas a esta temporada al crearlas (Nueva partida → Grupo y temporada)." />
      ) : (
        <Card style={{ paddingHorizontal: space.sm }}>
          <View style={[s.row, s.border]}>
            <Text style={[s.pos, s.th]}>#</Text>
            <Text style={[s.name, s.th]}>{season.ranking === 'parejas' ? 'Pareja' : 'Jugador'}</Text>
            <Text style={[s.num, s.th]}>PJ</Text>
            <Text style={[s.num, s.th]}>G</Text>
            <Text style={[s.num, s.th]}>P</Text>
            <Text style={[s.pts, s.th]}>Pts</Text>
          </View>
          {standings.rows.map((r, i) => (
            <View
              key={r.key}
              style={[s.row, i < standings.rows.length - 1 && s.border]}
              accessible
              accessibilityLabel={`Posición ${r.position}${r.tied ? ' (empate)' : ''}: ${r.name}, ${r.points} puntos, ${r.wins} ganadas de ${r.played}`}
            >
              <Text style={[s.pos, r.position === 1 && { color: colors.warning }]}>
                {r.position}
                {r.tied ? '=' : ''}
              </Text>
              <Text style={s.name} numberOfLines={2}>
                {r.name}
              </Text>
              <Text style={s.num}>{r.played}</Text>
              <Text style={[s.num, { color: colors.lime }]}>{r.wins}</Text>
              <Text style={[s.num, { color: colors.danger }]}>{r.losses}</Text>
              <Text style={s.pts}>{r.points}</Text>
            </View>
          ))}
          <Text style={s.note}>«=»: empate que persiste tras los desempates. Pts: puntos de clasificación (no son los puntos de las manos).</Text>
        </Card>
      )}

      <Card style={{ gap: 4 }}>
        <Text style={s.rowTitle}>Reglas</Text>
        {seasonRulesText(season).map((t) => (
          <Text key={t} style={s.meta}>
            • {t}
          </Text>
        ))}
      </Card>

      {season.final?.revisions?.length ? (
        <Card style={{ gap: 4 }}>
          <Text style={s.rowTitle}>Historial del resultado</Text>
          {season.final.revisions.map((rv) => (
            <Text key={rv.at} style={s.meta}>
              {formatDateTime(rv.at)} · {rv.reason}: {rv.champions.map((c) => c.name).join(', ') || 'sin campeón'}
            </Text>
          ))}
        </Card>
      ) : null}

      <Text style={s.subTitle}>Partidas de la temporada</Text>
      {games.length === 0 ? <Text style={s.meta}>Todavía no hay partidas.</Text> : null}
      {games.slice(0, 50).map((g) => (
        <GameSummary
          key={g.id}
          game={g}
          onPress={store.games.some((x) => x.id === g.id) ? () => router.push({ pathname: '/historial/[id]', params: { id: g.id } }) : undefined}
        />
      ))}
      {canManage && !finished && season.status !== 'cancelada' ? <Button label="Cancelar temporada" variant="ghost" size="sm" icon="close-circle-outline" onPress={cancel} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 28 },
  subTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 21, marginTop: space.sm },
  meta: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textDim, fontSize: 12, marginTop: space.sm },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.lime },
  champion: { alignItems: 'center', gap: 4 },
  championLabel: { color: colors.warning, fontFamily: fonts.black, fontSize: 18, letterSpacing: 3 },
  championName: { color: colors.text, fontFamily: fonts.display, fontSize: 30, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 4 },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  th: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  pos: { width: 30, color: colors.text, fontFamily: fonts.display, fontSize: 18, textAlign: 'center' },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  num: { width: 32, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '700' },
  pts: { width: 44, textAlign: 'center', color: colors.lime, fontFamily: fonts.display, fontSize: 20 },
  radius: { borderRadius: radius.md },
});
