import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newId, parsePoints, type Game } from '@/domain/game.ts';
import { parseVoiceCommand, type VoiceProposal } from '@/domain/voice.ts';
import { listenOnce, speechAvailability, speechErrorMessage, stopListening } from '@/services/speech';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { useDialogs } from './Dialogs';
import { Button, ErrorText } from './ui';

type Phase = 'listening' | 'processing' | 'review' | 'error';

/**
 * Anotación por voz. Solo propone: el marcador cambia únicamente al pulsar Confirmar,
 * y se registra con el mismo mecanismo (idempotente) que la anotación manual.
 */
export function VoiceScoreSheet({ game, onClose, onManual }: { game: Game; onClose: () => void; onManual: () => void }) {
  const store = useStore();
  const { toast } = useDialogs();
  const insets = useSafeAreaInsets();
  const [initialAvailability] = useState(speechAvailability);
  const [phase, setPhase] = useState<Phase>(initialAvailability.available ? 'listening' : 'error');
  const [partial, setPartial] = useState('');
  const [errorText, setErrorText] = useState(initialAvailability.available ? '' : initialAvailability.reason);
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [sideId, setSideId] = useState<string | null>(null);
  const [pointsText, setPointsText] = useState('');
  const [saving, setSaving] = useState(false);
  // Identificador fijo de la mano propuesta: un doble toque o un reintento no la duplica.
  const [handId] = useState(newId);
  const gameIdAtOpen = useRef(game.id);
  const cancelRef = useRef<(() => void) | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);

  const applyTranscript = (text: string) => {
    const p = parseVoiceCommand(text, game);
    setTranscript(text);
    setProposal(p);
    setSideId(p.sideId);
    setPointsText(p.points !== null ? String(p.points) : '');
    setPhase('review');
  };

  /** Reinicia la pantalla y vuelve a escuchar (botones Reintentar / Volver a escuchar). */
  const startListening = () => {
    const availability = speechAvailability();
    if (!availability.available) {
      setErrorText(availability.reason);
      setPhase('error');
      return;
    }
    setPartial('');
    setErrorText('');
    setPhase('listening');
    void listen();
  };

  /** Abre el micrófono; el estado solo cambia en las respuestas del reconocimiento. */
  const listen = async () => {
    let gotFinal = false;
    let failed = false;
    const names = [...game.sides.map((s) => s.name), ...game.participants.map((p) => p.name)];
    try {
      cancelRef.current = await listenOnce(
        {
          onPartial: (t) => alive.current && setPartial(t),
          onFinal: (t) => {
            if (!alive.current || gotFinal) return;
            gotFinal = true;
            setPhase('processing');
            applyTranscript(t);
          },
          onError: (code) => {
            if (!alive.current || gotFinal) return;
            failed = true;
            setErrorText(speechErrorMessage(code));
            setPhase('error');
          },
          onEnd: () => {
            cancelRef.current = null;
            if (alive.current && !gotFinal && !failed) {
              setErrorText(speechErrorMessage('no-speech'));
              setPhase('error');
            }
          },
        },
        names,
      );
    } catch {
      if (alive.current) {
        setErrorText(speechErrorMessage('unknown'));
        setPhase('error');
      }
    }
  };

  useEffect(() => {
    alive.current = true;
    if (initialAvailability.available) void listen();
    return () => {
      // Al salir se cancela la escucha y se libera el micrófono.
      alive.current = false;
      cancelRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    cancelRef.current?.();
    onClose();
  };

  const parsed = parsePoints(pointsText);
  const side = game.sides.find((s) => s.id === sideId);
  const canConfirm = phase === 'review' && parsed.ok && !!side && !saving;

  const confirm = async () => {
    if (!canConfirm || submitting.current || !parsed.ok || !side) return;
    const current = store.currentGame;
    if (!current || current.id !== gameIdAtOpen.current || current.status !== 'pendiente') {
      toast('La partida cambió mientras hablabas. No se anotó nada.', 'error');
      onClose();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await store.addHand(gameIdAtOpen.current, side.id, parsed.value, handId);
      toast(`Mano guardada: ${side.name} +${parsed.value}`);
      onClose();
    } catch (err) {
      submitting.current = false;
      setSaving(false);
      toast(err instanceof Error ? err.message : 'No se pudo guardar la mano.', 'error');
    }
  };

  const candidateIds = new Set(proposal?.candidateSideIds ?? []);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={saving ? undefined : close} accessibilityLabel="Cerrar" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>Anotar por voz</Text>
            <Pressable onPress={close} disabled={saving} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </Pressable>
          </View>

          {phase === 'listening' ? (
            <View style={s.center}>
              <View style={s.micPulse}>
                <Ionicons name="mic" size={44} color={colors.onLime} />
              </View>
              <Text style={s.state}>Escuchando…</Text>
              <Text style={s.hint}>Di, por ejemplo: “23 puntos para {game.sides[0]?.name}”</Text>
              {partial ? <Text style={s.partial}>“{partial}”</Text> : null}
              <View style={s.row}>
                <Button label="Cancelar" variant="outline" onPress={close} style={s.flex} />
                <Button label="Listo" icon="stop" onPress={stopListening} style={s.flex} />
              </View>
            </View>
          ) : null}

          {phase === 'processing' ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.lime} />
              <Text style={s.state}>Procesando…</Text>
            </View>
          ) : null}

          {phase === 'error' ? (
            <View style={s.center}>
              <Ionicons name="mic-off" size={40} color={colors.danger} />
              <Text style={s.state}>No se pudo anotar por voz</Text>
              <ErrorText>{errorText}</ErrorText>
              <View style={s.row}>
                <Button label="Anotar a mano" icon="keypad-outline" variant="outline" onPress={onManual} style={s.flex} />
                {speechAvailability().available ? (
                  <Button label="Reintentar" icon="mic" onPress={startListening} style={s.flex} />
                ) : null}
              </View>
            </View>
          ) : null}

          {phase === 'review' ? (
            <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={s.label}>Lo que se escuchó (puedes corregirlo)</Text>
                <TextInput
                  value={transcript}
                  onChangeText={setTranscript}
                  onEndEditing={() => applyTranscript(transcript)}
                  onSubmitEditing={() => applyTranscript(transcript)}
                  style={s.input}
                  placeholderTextColor={colors.textDim}
                  accessibilityLabel="Transcripción"
                />
              </View>

              {proposal?.issues.length ? (
                <View style={s.issues}>
                  {proposal.issues.map((issue) => (
                    <View key={issue} style={s.issueRow}>
                      <Ionicons name="alert-circle" size={16} color={colors.warning} />
                      <Text style={s.issueText}>{issue}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View>
                <Text style={s.label}>¿Para quién?</Text>
                <View style={s.sides}>
                  {game.sides.map((sd, i) => {
                    const c = sideColor(i);
                    const active = sd.id === sideId;
                    return (
                      <Pressable
                        key={sd.id}
                        onPress={() => setSideId(sd.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                        style={[
                          s.sideChip,
                          candidateIds.has(sd.id) && !active && { borderColor: colors.warning, borderStyle: 'dashed' },
                          active && { borderColor: c.main, backgroundColor: c.soft },
                        ]}
                      >
                        <View style={[s.dot, { backgroundColor: c.main }]} />
                        <Text style={[s.sideText, active && { color: c.main }]} numberOfLines={1}>
                          {sd.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={s.label}>Puntos</Text>
                <TextInput
                  value={pointsText}
                  onChangeText={(t) => setPointsText(t.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="0"
                  placeholderTextColor={colors.textDim}
                  style={[s.input, s.pointsInput]}
                  accessibilityLabel="Puntos"
                />
                {pointsText && !parsed.ok ? <ErrorText>{parsed.error}</ErrorText> : null}
              </View>

              <View style={[s.summary, canConfirm && { borderColor: colors.lime }]}>
                <Text style={s.summaryText}>
                  {canConfirm && parsed.ok && side
                    ? `Sumar ${parsed.value} ${parsed.value === 1 ? 'punto' : 'puntos'} a ${side.name}`
                    : 'Completa a quién y cuántos puntos'}
                </Text>
              </View>

              <View style={s.row}>
                <Button label="Cancelar" variant="outline" onPress={close} style={s.flex} disabled={saving} />
                <Button label="Confirmar" icon="checkmark" onPress={confirm} disabled={!canConfirm} loading={saving} style={s.flex} />
              </View>
              <Button label="Volver a escuchar" icon="mic-outline" variant="ghost" size="sm" onPress={startListening} disabled={saving} />
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
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
    maxHeight: '92%',
    alignSelf: 'center',
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24 },
  center: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  micPulse: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.lime,
    shadowOpacity: 0.7,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  state: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  hint: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  partial: { color: colors.text, fontSize: 18, textAlign: 'center', fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch' },
  flex: { flex: 1 },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.fieldStrong,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: space.md,
  },
  pointsInput: { fontFamily: fonts.display, fontSize: 32, textAlign: 'center' },
  issues: { gap: 6, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: space.md },
  issueRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  issueText: { color: colors.text, fontSize: 14, flex: 1 },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sideChip: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sideText: { color: colors.textMuted, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  summary: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: space.md, alignItems: 'center' },
  summaryText: { color: colors.text, fontFamily: fonts.heading, fontSize: 21, textAlign: 'center' },
});
