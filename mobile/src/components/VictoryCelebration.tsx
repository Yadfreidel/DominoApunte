// Celebración de victoria: confeti, trofeo, entrada animada del ganador y marcador final.
// Trabaja sobre una copia del resultado (VictorySummary), así sigue mostrando los puntos finales
// aunque la siguiente partida ya empiece en cero. Al terminar la cuenta regresiva (o con «Jugar de
// nuevo») prepara la siguiente partida una sola vez; en torneos vuelve al cuadro.
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { VictorySummary } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { useReduceMotion } from './StarterDraw';
import { Button, ErrorText } from './ui';

const AUTO_SECONDS = 9;
const CONFETTI = 36;

interface Props {
  summary: VictorySummary;
  /** Partida de torneo: no se crea revancha, se vuelve al cuadro. */
  tournament: boolean;
  onNext: () => Promise<void>;
  onClose: () => void;
  /** Racha de victorias seguidas del ganador, calculada con las partidas guardadas. */
  streak?: number;
  /** Abre la tarjeta del ganador para compartir (detiene la cuenta regresiva). */
  onShare?: () => void;
}

export function VictoryCelebration({ summary, tournament, onNext, onClose, streak = 0, onShare }: Props) {
  const reduce = useReduceMotion();
  const { settings } = useStore();
  const [seconds, setSeconds] = useState(AUTO_SECONDS);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(reduce ? summary.points : 0);
  // Bloqueo síncrono: el final automático y el botón no pueden preparar dos partidas.
  const finishing = useRef(false);
  const accent = sideColor(summary.winnerIndex).main;

  const [intro] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [trophy] = useState(() => new Animated.Value(reduce ? 1 : 0));

  const next = async () => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError(null);
    try {
      await onNext();
    } catch (err) {
      // El resultado ya está guardado en el historial; solo falló preparar la siguiente partida.
      finishing.current = false;
      setPaused(true);
      setError(err instanceof Error ? err.message : 'No se pudo preparar la siguiente partida.');
    } finally {
      setBusy(false);
    }
  };
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });

  // Entrada: trofeo con rebote y nombre que sube; los puntos cuentan hasta el total final.
  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.spring(trophy, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
      Animated.timing(intro, { toValue: 1, duration: 650, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const p = Math.min(1, (Date.now() - startedAt) / 1100);
      setShown(Math.round(summary.points * (1 - (1 - p) ** 3)));
      if (p >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [intro, trophy, reduce, summary.points]);

  // Sonido solo si el usuario lo activó; si el dispositivo o el navegador no lo permite, se ignora.
  useEffect(() => {
    if (!settings.victorySound) return;
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    try {
      player = createAudioPlayer(require('../../assets/sounds/victoria.wav'));
      player.play();
    } catch {
      player = null;
    }
    return () => {
      try {
        player?.remove();
      } catch {
        // ignorado
      }
    };
  }, [settings.victorySound]);

  // Cuenta regresiva hasta preparar la siguiente partida.
  useEffect(() => {
    if (paused) return;
    if (seconds <= 0) {
      void nextRef.current();
      return;
    }
    const t = setTimeout(() => setSeconds((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, paused]);

  const rise = {
    opacity: intro,
    transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
  };
  const trophyStyle = {
    transform: [
      { scale: trophy },
      { rotate: trophy.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-30deg', '12deg', '0deg'] }) },
    ],
  };

  return (
    <Modal visible transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={s.backdrop} accessibilityViewIsModal>
        {reduce ? null : <Confetti />}
        <View style={[s.card, { borderColor: accent, shadowColor: accent }]}>
          <Animated.View style={[s.trophyWrap, trophyStyle]}>
            <Ionicons name="trophy" size={84} color={colors.warning} style={s.trophyGlow} />
          </Animated.View>
          <Animated.View style={[s.texts, rise]}>
            <Text style={[s.headline, { color: accent }]} accessibilityRole="header" accessibilityLiveRegion="assertive">
              {summary.headline}
            </Text>
            {summary.members ? <Text style={s.members}>{summary.members}</Text> : null}
            <Text style={s.points}>{shown}</Text>
            <Text style={[s.detail, summary.exact && { color: colors.warning }]}>{summary.detail}</Text>
            {!summary.exact ? <Text style={s.target}>Meta: {summary.target} puntos</Text> : null}
            {streak >= 2 ? (
              <Text style={s.streak}>
                {summary.members || summary.scores.find((x) => x.winner)?.name} {summary.headline.includes('ganaron') ? 'llevan' : 'lleva'} {streak} victorias seguidas
              </Text>
            ) : null}
          </Animated.View>

          <View style={s.scores} accessibilityLabel="Marcador final">
            {summary.scores.map((sc, i) => (
              <View key={sc.sideId} style={[s.scoreRow, sc.winner && { borderColor: sideColor(i).main, backgroundColor: sideColor(i).soft }]}>
                {sc.winner ? <Ionicons name="trophy" size={16} color={colors.warning} /> : <View style={{ width: 16 }} />}
                <Text style={[s.scoreName, { color: sideColor(i).main }]} numberOfLines={1}>
                  {sc.name}
                </Text>
                <Text style={s.scorePoints}>{sc.points}</Text>
              </View>
            ))}
          </View>

          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button
            label={error ? 'Reintentar' : tournament ? 'Volver al torneo' : 'Jugar de nuevo'}
            icon={tournament ? 'trophy-outline' : 'refresh'}
            size="lg"
            onPress={next}
            loading={busy}
            style={{ alignSelf: 'stretch' }}
          />
          {onShare ? (
            <Button
              label="Compartir victoria"
              icon="share-social-outline"
              variant="outline"
              onPress={() => {
                setPaused(true); // la siguiente partida espera mientras se comparte
                onShare();
              }}
              style={{ alignSelf: 'stretch' }}
            />
          ) : null}
          <Text style={s.countdown}>
            {paused
              ? 'Resultado guardado en el historial.'
              : tournament
                ? `Volviendo al torneo en ${Math.max(0, seconds)} s · resultado guardado`
                : `Siguiente partida en ${Math.max(0, seconds)} s · resultado guardado`}
          </Text>
          <Button
            label="Ver el resultado"
            variant="ghost"
            size="sm"
            onPress={() => {
              finishing.current = true; // cancela el final automático
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Lluvia de confeti con animaciones nativas (sin repintar React en cada cuadro). */
export function Confetti() {
  const { width, height } = useWindowDimensions();
  const [pieces] = useState(() =>
    Array.from({ length: CONFETTI }, (_, i) => ({
      x: Math.random(),
      size: 6 + Math.random() * 7,
      color: [colors.lime, colors.purple, colors.warning, colors.info, colors.text][i % 5],
      delay: Math.random() * 900,
      duration: 2600 + Math.random() * 1800,
      sway: (Math.random() - 0.5) * 80,
      round: i % 3 === 0,
      value: new Animated.Value(0),
    })),
  );
  useEffect(() => {
    const anims = pieces.map((p) =>
      Animated.loop(Animated.timing(p.value, { toValue: 1, duration: p.duration, delay: p.delay, easing: Easing.linear, useNativeDriver: true }), {
        iterations: 3,
      }),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [pieces]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x * width,
            top: -20,
            width: p.size,
            height: p.round ? p.size : p.size * 1.8,
            borderRadius: p.round ? p.size / 2 : 2,
            backgroundColor: p.color,
            transform: [
              { translateY: p.value.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
              { translateX: p.value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.sway, 0] }) },
              { rotate: p.value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 + i * 20}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.lg },
  card: {
    backgroundColor: colors.surfaceSolid,
    borderWidth: 2,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
    alignItems: 'center',
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    shadowOpacity: 0.8,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  trophyWrap: { alignItems: 'center', justifyContent: 'center' },
  // Brillo dorado del propio ícono (sin caja de sombra detrás).
  trophyGlow: { textShadowColor: colors.warning, textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } },
  texts: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  headline: { fontFamily: fonts.black, fontSize: 38, textAlign: 'center', lineHeight: 42 },
  members: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
  points: { color: colors.text, fontFamily: fonts.display, fontSize: 84, lineHeight: 90 },
  detail: { color: colors.lime, fontFamily: fonts.heading, fontSize: 22, textAlign: 'center' },
  target: { color: colors.textDim, fontSize: 13 },
  streak: { color: colors.warning, fontFamily: fonts.heading, fontSize: 18, textAlign: 'center', marginTop: 2 },
  scores: { alignSelf: 'stretch', gap: 6 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  scoreName: { flex: 1, fontFamily: fonts.heading, fontSize: 18 },
  scorePoints: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
  countdown: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
