import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { StarterDraw } from '@/components/StarterDraw';
import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { totals } from '@/domain/game.ts';
import { lockReason, resolveTournament, type ResolvedMatch } from '@/domain/tournament.ts';
import { goBackOr, useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';

const STATE_LABEL: Record<ResolvedMatch['state'], { label: string; color: string }> = {
  esperando: { label: 'Esperando rivales', color: colors.textDim },
  listo: { label: 'Listo para jugar', color: colors.lime },
  en_juego: { label: 'En juego', color: colors.warning },
  terminado: { label: 'Terminado', color: colors.success },
  pase: { label: 'Pase automático', color: colors.purple },
};

export default function TournamentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const goTo = useGoTo();
  const { confirm, toast } = useDialogs();
  const t = store.tournaments.find((x) => x.id === id);
  const resolved = useMemo(() => (t ? resolveTournament(t, store.games) : null), [t, store.games]);
  const [starting, setStarting] = useState<ResolvedMatch | null>(null);

  if (!t || !resolved) {
    return (
      <Screen header={<AppHeader subtitle="Torneo" />}>
        <EmptyState
          icon="alert-circle-outline"
          title="Torneo no encontrado"
          message="Puede que no exista en este dispositivo."
          action={<Button label="Ver torneos" variant="outline" onPress={() => goBackOr('/torneos')} />}
        />
      </Screen>
    );
  }

  const openGame = async (m: ResolvedMatch) => {
    if (!m.game) return;
    await store.resumeGame(m.game.id);
    goTo('/partida');
  };

  const cancel = async () => {
    const ok = await confirm({
      title: '¿Cancelar el torneo?',
      message: 'El cuadro queda guardado como cancelado. Las partidas ya jugadas se conservan en el historial.',
      confirmLabel: 'Cancelar torneo',
      cancelLabel: 'Volver',
      destructive: true,
    });
    if (!ok) return;
    await store.cancelTournament(t.id);
    toast('Torneo cancelado', 'info');
  };

  const paused = t.status === 'pausado' && resolved.status === 'en_curso';
  const statusText =
    resolved.status === 'terminado' ? 'Terminado' : resolved.status === 'cancelado' ? 'Cancelado' : paused ? 'En pausa' : 'En curso';

  return (
    <Screen header={<AppHeader subtitle={t.name} />} maxWidth={1240}>
      <Button label="Torneos" icon="arrow-back" variant="ghost" size="sm" onPress={() => goBackOr('/torneos')} style={{ alignSelf: 'flex-start' }} />
      <Card style={{ gap: 4 }}>
        <Text style={s.title}>{t.name}</Text>
        <Text style={s.meta}>
          {t.mode === 'parejas' ? 'Por parejas' : 'Individual'} · {t.entrants.length} {t.mode === 'parejas' ? 'parejas' : 'jugadores'} · meta {t.target} ·{' '}
          {statusText}
        </Text>
      </Card>

      {paused ? (
        <Card accent={colors.warning} style={s.pausedCard}>
          <Ionicons name="pause-circle" size={26} color={colors.warning} />
          <Text style={s.pausedText}>Torneo en pausa: el organizador debe reanudarlo para empezar nuevos enfrentamientos.</Text>
        </Card>
      ) : null}

      {resolved.champion ? (
        <Card accent={colors.warning} style={s.champion}>
          <Ionicons name="trophy" size={44} color={colors.warning} />
          <Text style={s.championLabel}>CAMPEÓN</Text>
          <Text style={s.championName}>{resolved.champion.name}</Text>
          {t.mode === 'parejas' ? <Text style={s.meta}>{resolved.champion.players.map((p) => p.name).join(' y ')}</Text> : null}
        </Card>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.bracket}>
        {resolved.rounds.map((round, r) => (
          <View key={r} style={s.column}>
            <Text style={s.roundTitle}>{round[0]?.roundName}</Text>
            <Text style={s.roundSub}>Ronda {r + 1} de {resolved.rounds.length}</Text>
            <View style={[s.matches, { gap: space.md * 2 ** r }]}>
              {round.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  locked={m.game ? !!lockReason(t, store.games, m.game) : false}
                  disabled={resolved.status === 'cancelado' || paused}
                  onPlay={() => setStarting(m)}
                  onOpen={() => openGame(m)}
                  onView={() => m.game && router.push({ pathname: '/historial/[id]', params: { id: m.game.id } })}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={s.hint}>Desliza horizontalmente para ver todas las rondas. Los pases automáticos avanzan sin jugar y no cuentan como victorias.</Text>

      {resolved.status === 'en_curso' ? <Button label="Cancelar torneo" variant="ghost" size="sm" icon="close-circle-outline" onPress={cancel} /> : null}

      {starting ? (
        <StartMatch
          match={starting}
          onClose={() => setStarting(null)}
          onStart={async (starterIndex) => {
            try {
              await store.startTournamentMatch(t.id, starting.id, starterIndex);
              setStarting(null);
              goTo('/partida');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'No se pudo iniciar la partida.', 'error');
            }
          }}
        />
      ) : null}
    </Screen>
  );
}

function MatchCard({
  match: m,
  locked,
  disabled,
  onPlay,
  onOpen,
  onView,
}: {
  match: ResolvedMatch;
  locked: boolean;
  disabled: boolean;
  onPlay: () => void;
  onOpen: () => void;
  onView: () => void;
}) {
  const st = STATE_LABEL[m.state];
  const score = m.game ? totals(m.game) : null;
  const entrantScore = (entrantId: string | undefined) => {
    if (!score || !entrantId || !m.game) return null;
    const side = m.game.sides.find((sd) => sd.entrantId === entrantId);
    return side ? score[side.id] : null;
  };
  const line = (entrant: ResolvedMatch['a'], i: number) => {
    const won = !!entrant && m.winner?.id === entrant.id && m.state !== 'pase';
    const pts = entrantScore(entrant?.id);
    return (
      <View style={[s.slot, won && { backgroundColor: `${sideColor(i).main}22` }]}>
        <View style={[s.dot, { backgroundColor: entrant ? sideColor(i).main : colors.border }]} />
        <Text style={[s.slotName, !entrant && s.slotEmpty, won && { color: colors.text, fontWeight: '800' }]} numberOfLines={1}>
          {entrant ? entrant.name : m.isBye && i === 1 ? 'Pase automático' : 'Por definir'}
        </Text>
        {won ? <Ionicons name="trophy" size={14} color={colors.warning} /> : null}
        {pts != null ? <Text style={[s.pts, { color: sideColor(i).main }]}>{pts}</Text> : null}
      </View>
    );
  };
  return (
    <View style={[s.match, m.state === 'listo' && { borderColor: colors.lime }, m.isBye && { borderStyle: 'dashed' }]}>
      {line(m.a, 0)}
      {line(m.b, 1)}
      <View style={s.matchFoot}>
        <Text style={[s.state, { color: st.color }]}>{st.label}</Text>
        {locked ? (
          <View style={s.lock} accessibilityLabel="Resultado cerrado: la siguiente ronda ya empezó">
            <Ionicons name="lock-closed" size={12} color={colors.textDim} />
            <Text style={s.lockText}>Cerrado</Text>
          </View>
        ) : null}
      </View>
      {!disabled && m.state === 'listo' ? <Button label="Jugar" icon="play" size="sm" onPress={onPlay} /> : null}
      {m.state === 'en_juego' ? <Button label="Continuar partida" icon="play" size="sm" variant="outline" onPress={onOpen} /> : null}
      {m.state === 'terminado' ? <Button label="Ver partida" size="sm" variant="ghost" onPress={onView} /> : null}
    </View>
  );
}

function StartMatch({ match, onClose, onStart }: { match: ResolvedMatch; onClose: () => void; onStart: (starter: number | null) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [starter, setStarter] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const players = [...(match.a?.players ?? []), ...(match.b?.players ?? [])];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel="Cerrar" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <Text style={s.sheetTitle}>{match.roundName}</Text>
          <Text style={s.vsLine}>
            <Text style={{ color: colors.lime }}>{match.a?.name}</Text>
            <Text style={{ color: colors.textDim }}> vs </Text>
            <Text style={{ color: colors.purple }}>{match.b?.name}</Text>
          </Text>
          <StarterDraw names={players.map((p) => p.name)} value={starter} onResult={setStarter} disabled={busy} />
          <View style={s.row}>
            <Button label="Cancelar" variant="outline" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
            <Button
              label="Comenzar partida"
              icon="play"
              loading={busy}
              onPress={async () => {
                setBusy(true);
                await onStart(starter);
                setBusy(false);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  pausedCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pausedText: { color: colors.text, fontSize: 15, flex: 1 },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24 },
  meta: { color: colors.textMuted, fontSize: 14 },
  champion: { alignItems: 'center', gap: 4 },
  championLabel: { color: colors.warning, fontWeight: '800', letterSpacing: 3, fontSize: 14 },
  championName: { color: colors.text, fontFamily: fonts.black, fontSize: 34, textAlign: 'center' },
  bracket: { gap: space.lg, paddingVertical: space.sm, alignItems: 'flex-start' },
  column: { width: 250 },
  roundTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 19 },
  roundSub: { color: colors.textDim, fontSize: 12, marginBottom: space.sm },
  matches: { justifyContent: 'space-around' },
  match: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderSoft,
    padding: space.sm,
    gap: 4,
  },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 6, borderRadius: radius.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  slotName: { flex: 1, color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  slotEmpty: { color: colors.textDim, fontStyle: 'italic', fontWeight: '400' },
  pts: { fontFamily: fonts.display, fontSize: 20 },
  matchFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  state: { fontSize: 12, fontWeight: '700' },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { color: colors.textDim, fontSize: 11 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  sheetTitle: { color: colors.textMuted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  vsLine: { fontFamily: fonts.heading, fontSize: 24 },
  row: { flexDirection: 'row', gap: space.md },
});
