import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { NumericKeypad, type KeypadSide } from '@/components/NumericKeypad';
import { VoiceScoreSheet } from '@/components/VoiceScoreSheet';
import { HandLedger, ScoreCard } from '@/components/Score';
import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { newId, sideLabel, totals as computeTotals } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { useGoTo } from '@/navigation';

type KeypadState =
  | { kind: 'add'; handId: string; sideId: string | null; initialValue: string }
  | { kind: 'edit'; handId: string; sideId: string; initialValue: string; number: number };

export default function Scoreboard() {
  const store = useStore();
  const game = store.currentGame;
  const { confirm, toast } = useDialogs();
  const [keypad, setKeypad] = useState<KeypadState | null>(null);
  /** Mano que se está consultando con las flechas; se descarta al cambiar de partida o de número de manos. */
  const [browseState, setBrowseState] = useState<{ key: string; index: number | null }>({ key: '', index: null });
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const goTo = useGoTo();
  const browseKey = `${game?.id}:${game?.hands.length}`;
  const browse = browseState.key === browseKey ? browseState.index : null;
  const setBrowse = (update: (b: number | null) => number | null) =>
    setBrowseState({ key: browseKey, index: update(browse) });

  if (!game) {
    return (
      <Screen header={<AppHeader subtitle="Partida en curso" />}>
        <EmptyState
          icon="grid-outline"
          title="No hay partida en curso"
          message="Configura los jugadores y la meta para empezar a anotar."
          action={<Button label="Nueva partida" icon="add" onPress={() => router.replace('/nueva')} />}
        />
      </Screen>
    );
  }

  const totals = computeTotals(game);
  const pending = game.status === 'pendiente';
  const finished = game.status === 'terminada';
  const winner = game.sides.find((sd) => sd.id === game.winnerSideId);
  const max = Math.max(...Object.values(totals));
  const leaders = game.sides.filter((sd) => totals[sd.id] === max);
  const leaderId = max > 0 && leaders.length === 1 ? leaders[0].id : null;
  const team = game.mode === 'parejas';
  const compact = game.sides.length > 2;
  const membersOf = (sd: (typeof game.sides)[number]) =>
    sd.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name ?? '').filter(Boolean);
  const keypadSides: KeypadSide[] = game.sides.map((sd, index) => ({ id: sd.id, name: sd.name, index }));

  const handCount = game.hands.length;
  const currentNumber = pending ? handCount + 1 : handCount;
  const viewed = browse != null ? game.hands[browse] : null;
  const viewedSideIndex = viewed ? game.sides.findIndex((sd) => sd.id === viewed.sideId) : -1;

  const openAdd = (sideId: string | null, initialValue = '') => {
    if (!pending) return;
    setKeypad({ kind: 'add', handId: newId(), sideId, initialValue });
  };

  const openEdit = (handId: string) => {
    if (game.status === 'cancelada') return;
    const index = game.hands.findIndex((h) => h.id === handId);
    const hand = game.hands[index];
    if (!hand) return;
    setKeypad({ kind: 'edit', handId, sideId: hand.sideId, initialValue: String(hand.points), number: index + 1 });
  };

  const submitKeypad = async (sideId: string, points: number) => {
    if (!keypad) return;
    if (keypad.kind === 'add') {
      await store.addHand(game.id, sideId, points, keypad.handId);
      const name = game.sides.find((sd) => sd.id === sideId)?.name;
      toast(`Mano guardada: ${name} +${points}`);
    } else {
      await store.editHand(game.id, keypad.handId, { points, sideId });
      toast(`Mano ${keypad.number} corregida`);
    }
    setKeypad(null);
  };

  const removeHand = async (handId: string) => {
    const index = game.hands.findIndex((h) => h.id === handId);
    const hand = game.hands[index];
    if (!hand || busy) return;
    const side = game.sides.find((sd) => sd.id === hand.sideId);
    const ok = await confirm({
      title: `¿Borrar la mano ${index + 1}?`,
      message: `${side?.name} +${hand.points}. Se recalculará el marcador.`,
      confirmLabel: 'Borrar mano',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await store.removeHand(game.id, handId);
      toast(`Mano ${index + 1} borrada`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo borrar la mano.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const last = game.hands[handCount - 1];
    if (!last || busy) return;
    const side = game.sides.find((sd) => sd.id === last.sideId);
    const ok = await confirm({
      title: '¿Deshacer la última mano?',
      message: `Se eliminará la mano ${handCount} (${side?.name} +${last.points}) y se recalculará el marcador.`,
      confirmLabel: 'Deshacer',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await store.undoLastHand(game.id);
      toast('Mano deshecha');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo deshacer.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rematch = async () => {
    setBusy(true);
    try {
      await store.rematch(game.id);
      toast('¡Revancha! Marcadores en cero.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo crear la revancha.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: '¿Cancelar la partida?',
      message: 'Quedará en el historial como cancelada y ya no se podrán anotar puntos.',
      confirmLabel: 'Cancelar partida',
      cancelLabel: 'Volver',
      destructive: true,
    });
    if (!ok) return;
    try {
      await store.cancelGame(game.id);
      toast('Partida cancelada', 'info');
      router.replace('/nueva');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cancelar.', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle={`Partida a ${game.target} puntos`} />}>
      {game.adminLocked ? (
        <View style={s.notice}>
          <Ionicons name="shield-checkmark" size={18} color={colors.purple} />
          <Text style={s.noticeText}>Un administrador corrigió esta partida.</Text>
        </View>
      ) : null}

      <View style={[s.cards, compact && s.cardsWrap]}>
        {game.sides.map((sd, i) => (
          <View key={sd.id} style={compact ? s.cardCell : s.cardFlex}>
            <ScoreCard
              name={sd.name}
              detail={team && sideLabel(game, sd) !== sd.name ? sideLabel(game, sd) : undefined}
              members={membersOf(sd)}
              total={totals[sd.id]}
              target={game.target}
              index={i}
              team={team}
              leading={pending && leaderId === sd.id}
              winner={game.winnerSideId === sd.id}
              compact={compact}
              onAdd={pending ? () => openAdd(sd.id) : undefined}
            />
          </View>
        ))}
        {!compact ? (
          <View style={s.vs} pointerEvents="none">
            <Text style={s.vsText}>VS</Text>
          </View>
        ) : null}
      </View>

      {finished && winner ? (
        <Card style={s.winner} accent={sideColor(game.sides.indexOf(winner)).main}>
          <Ionicons name="trophy" size={44} color={colors.warning} />
          <Text style={s.winnerTitle}>¡Ganó {winner.name}!</Text>
          {team && sideLabel(game, winner) !== winner.name ? <Text style={s.winnerSub}>{sideLabel(game, winner)}</Text> : null}
          <Text style={s.winnerSub}>
            {totals[winner.id]} puntos · meta {game.target} · {handCount} manos
          </Text>
          <View style={s.winnerActions}>
            <Button label="Revancha" icon="refresh" onPress={rematch} loading={busy} style={{ flex: 1 }} />
            <Button label="Nueva" icon="add" variant="outline" onPress={() => goTo('/nueva')} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {game.status === 'cancelada' ? (
        <EmptyState
          icon="close-circle-outline"
          title="Partida cancelada"
          message="Esta partida fue cancelada y no admite más puntos."
          action={<Button label="Nueva partida" icon="add" onPress={() => router.replace('/nueva')} />}
        />
      ) : null}

      {game.status !== 'cancelada' && handCount > 0 ? (
        <View style={s.handNav}>
          <Pressable
            onPress={() => setBrowse((b) => (b == null ? handCount - 1 : Math.max(0, b - 1)))}
            disabled={browse === 0}
            accessibilityRole="button"
            accessibilityLabel="Mano anterior"
            hitSlop={8}
            style={[s.chevron, browse === 0 && { opacity: 0.3 }]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          {viewed ? (
            <Pressable style={s.handNavCenter} onPress={() => openEdit(viewed.id)} accessibilityRole="button">
              <Text style={s.handNavTitle}>Mano {browse! + 1}</Text>
              <Text style={[s.handNavDetail, { color: sideColor(viewedSideIndex).main }]}>
                {game.sides[viewedSideIndex]?.name} +{viewed.points} · tocar para editar
              </Text>
            </Pressable>
          ) : (
            <View style={s.handNavCenter}>
              <Text style={s.handNavTitle}>{pending ? `Mano ${currentNumber}` : `${handCount} manos`}</Text>
            </View>
          )}
          <Pressable
            onPress={() => setBrowse((b) => (b == null || b >= handCount - 1 ? null : b + 1))}
            disabled={browse == null}
            accessibilityRole="button"
            accessibilityLabel="Mano siguiente"
            hitSlop={8}
            style={[s.chevron, browse == null && { opacity: 0.3 }]}
          >
            <Ionicons name="chevron-forward" size={24} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {pending ? (
        <View style={s.assist}>
          <Button label="Voz" icon="mic-outline" variant="outline" size="sm" onPress={() => setVoiceOpen(true)} style={s.assistBtn} />
          <Button
            label="Contar fichas"
            icon="scan-outline"
            variant="outline"
            size="sm"
            onPress={() => router.push({ pathname: '/contar', params: { gameId: game.id } })}
            style={s.assistBtn}
          />
        </View>
      ) : null}

      {pending && handCount === 0 ? (
        <View style={s.tapHint}>
          <Ionicons name="hand-left-outline" size={16} color={colors.textMuted} />
          <Text style={s.tapHintText}>Toca el equipo que ganó la mano para anotar sus puntos</Text>
        </View>
      ) : null}

      {game.status !== 'cancelada' ? (
        <Button
          label="Deshacer"
          icon="arrow-undo-outline"
          variant="outline"
          onPress={undo}
          disabled={handCount === 0}
          loading={busy && !finished}
        />
      ) : null}

      <View style={s.historyHeader}>
        <Text style={s.historyTitle}>Historial de manos</Text>
        {handCount > 0 && game.status !== 'cancelada' ? (
          <Text style={s.historyHint}>Toca los números de una mano para corregirla</Text>
        ) : null}
      </View>
      <HandLedger
        game={game}
        onEdit={game.status !== 'cancelada' ? openEdit : undefined}
        onDelete={game.status !== 'cancelada' ? removeHand : undefined}
      />

      <View style={s.footer}>
        <Ionicons name="phone-portrait-outline" size={14} color={colors.textDim} />
        <Text style={s.footerText}>
          Cada mano se guarda en el dispositivo al confirmarla
          {store.user ? (store.sync.pending ? ` · ${store.sync.pending} por sincronizar` : ' · sincronizado') : ''}
        </Text>
      </View>
      {pending ? <Button label="Cancelar partida" variant="ghost" size="sm" icon="close-circle-outline" onPress={cancel} /> : null}

      {voiceOpen && pending ? (
        <VoiceScoreSheet
          game={game}
          onClose={() => setVoiceOpen(false)}
          onManual={() => {
            setVoiceOpen(false);
            openAdd(null);
          }}
        />
      ) : null}

      <NumericKeypad
        key={keypad?.handId ?? 'cerrado'}
        visible={!!keypad}
        title={keypad?.kind === 'edit' ? `Corregir mano ${keypad.number}` : `Mano ${currentNumber}: puntos`}
        sides={keypadSides}
        initialSideId={keypad?.sideId ?? null}
        initialValue={keypad?.initialValue ?? ''}
        confirmLabel={keypad?.kind === 'edit' ? 'Guardar corrección' : 'Confirmar'}
        onSubmit={submitKeypad}
        onClose={() => setKeypad(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(160, 107, 255, 0.12)',
    borderRadius: radius.md,
    padding: space.md,
  },
  noticeText: { color: colors.text, fontSize: 14, flex: 1 },
  cards: { flexDirection: 'row', gap: space.md },
  vs: {
    position: 'absolute',
    left: '50%',
    top: 44,
    marginLeft: -21,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: '#3A4A9A',
  },
  vsText: { color: colors.text, fontFamily: fonts.black, fontSize: 16, letterSpacing: 1 },
  cardsWrap: { flexWrap: 'wrap' },
  cardFlex: { flex: 1 },
  cardCell: { flexBasis: '47%', flexGrow: 1 },
  winner: { alignItems: 'center', gap: space.sm },
  winnerTitle: { color: colors.text, fontFamily: fonts.black, fontSize: 36, textAlign: 'center' },
  winnerSub: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  winnerActions: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch', marginTop: space.sm },
  handNav: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 220,
    borderWidth: 1.5,
    borderColor: '#3A4A9A',
    backgroundColor: 'rgba(14, 22, 64, 0.9)',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    minHeight: 50,
  },
  chevron: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  handNavCenter: { flex: 1, alignItems: 'center', paddingHorizontal: space.sm },
  handNavTitle: { color: colors.text, fontSize: 21, fontWeight: '700' },
  handNavDetail: { fontSize: 12, fontWeight: '600' },
  assist: { flexDirection: 'row', gap: space.sm },
  assistBtn: { flex: 1 },
  tapHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.md },
  tapHintText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', flexShrink: 1 },
  historyHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  historyTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  historyHint: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  footerText: { color: colors.textDim, fontSize: 12, textAlign: 'center', flexShrink: 1 },
});
