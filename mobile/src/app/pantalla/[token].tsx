// Marcador para pantalla grande (espectador). Público y de solo lectura: muestra una sola partida a
// partir de un enlace revocable. Consulta el servidor cada pocos segundos, indica si se perdió la
// conexión o si los datos están desactualizados, y al reconectar toma el estado más reciente.
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StadiumBackground } from '@/components/ui';
import { useReduceMotion } from '@/components/StarterDraw';
import { Confetti } from '@/components/VictoryCelebration';
import {
  applyFailure,
  applySnapshot,
  connectionStatus,
  initialSpectatorState,
  spectatorVictory,
  type ConnectionStatus,
  type SpectatorSnapshot,
  type SpectatorState,
} from '@/domain/spectator.ts';
import { ApiError, request } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';

const POLL_MS = 2500;

const STATUS_TEXT: Record<ConnectionStatus, { label: string; color: string; icon: 'radio' | 'sync' | 'cloud-offline-outline' | 'time-outline' | 'close-circle-outline' }> = {
  conectando: { label: 'Conectando…', color: colors.textMuted, icon: 'sync' },
  en_vivo: { label: 'En vivo', color: colors.success, icon: 'radio' },
  reconectando: { label: 'Sin conexión · reintentando', color: colors.warning, icon: 'cloud-offline-outline' },
  desactualizado: { label: 'Datos desactualizados', color: colors.warning, icon: 'time-outline' },
  no_disponible: { label: 'Enlace no disponible', color: colors.danger, icon: 'close-circle-outline' },
};

export default function BigScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { settings, ready } = useStore();
  const [state, setState] = useState<SpectatorState>(initialSpectatorState);
  const [clock, setClock] = useState(() => Date.now());
  const inFlight = useRef(false);
  /** Enlace revocado o partida eliminada: se deja de consultar. */
  const gone = useRef(false);
  const apiUrl = settings.apiUrl;

  // Consulta periódica. Una consulta no se superpone con otra; al volver la conexión se toma el estado actual.
  useEffect(() => {
    if (!ready || !apiUrl || !token) return;
    let alive = true;
    const tick = async () => {
      setClock(Date.now());
      if (inFlight.current || gone.current) return;
      inFlight.current = true;
      try {
        const snap = await request<SpectatorSnapshot>(apiUrl, `/spectate/${encodeURIComponent(token)}`, { timeoutMs: 8000 });
        if (alive) setState((st) => applySnapshot(st, snap, Date.now()));
      } catch (err) {
        const isGone = err instanceof ApiError && err.status === 404;
        if (isGone) gone.current = true;
        if (alive) setState((st) => applyFailure(st, err instanceof Error ? err.message : 'Sin conexión', Date.now(), isGone));
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ready, apiUrl, token]);

  const status = connectionStatus(state, clock);
  const data = state.data;
  const victory = data ? spectatorVictory(data) : null;

  return (
    <View style={s.root}>
      <StadiumBackground />
      <TopBar status={status} data={data} />
      {!data ? (
        <View style={s.center}>
          <Text style={s.waiting}>
            {state.gone ? 'Este enlace fue desactivado o la partida ya no está disponible.' : !apiUrl ? 'Esta pantalla no tiene configurado el servidor.' : 'Cargando el marcador…'}
          </Text>
        </View>
      ) : (
        <Board data={data} scored={state.scored} />
      )}
      {data?.lastHand ? (
        <Text style={s.last} accessibilityLiveRegion="polite">
          Última anotación: mano {data.lastHand.number} · {data.sides.find((x) => x.id === data.lastHand!.sideId)?.name} +{data.lastHand.points}
        </Text>
      ) : null}
      {victory ? <Celebration headline={victory.headline} detail={victory.detail} /> : null}
    </View>
  );
}

function TopBar({ status, data }: { status: ConnectionStatus; data: SpectatorSnapshot | null }) {
  const st = STATUS_TEXT[status];
  const canFullscreen = Platform.OS === 'web' && typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  return (
    <View style={s.top}>
      <View style={[s.badge, { borderColor: st.color }]} accessibilityLiveRegion="polite">
        <Ionicons name={st.icon} size={18} color={st.color} />
        <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
      </View>
      {data ? (
        <Text style={s.target}>
          Meta {data.target} · {data.status === 'terminada' ? 'Partida terminada' : data.status === 'cancelada' ? 'Partida cancelada' : 'En juego'}
        </Text>
      ) : null}
      {canFullscreen ? (
        <Pressable
          onPress={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
          accessibilityRole="button"
          accessibilityLabel="Pantalla completa"
          style={s.fsBtn}
        >
          <Ionicons name="expand-outline" size={22} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Board({ data, scored }: { data: SpectatorSnapshot; scored: SpectatorState['scored'] }) {
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;
  const n = data.sides.length;
  const scoreSize = Math.max(64, Math.min(landscape ? width / (n * 2.6) : width / 3, height / (landscape ? 2.6 : n * 2.2)));
  return (
    <View style={[s.board, { flexDirection: landscape ? 'row' : 'column' }]}>
      {data.sides.map((side, i) => (
        <SideCard key={side.id} side={side} index={i} target={data.target} winner={data.winnerSideId === side.id} scoreSize={scoreSize} scored={scored?.sideId === side.id ? scored : null} />
      ))}
    </View>
  );
}

function SideCard({
  side,
  index,
  target,
  winner,
  scoreSize,
  scored,
}: {
  side: SpectatorSnapshot['sides'][number];
  index: number;
  target: number;
  winner: boolean;
  scoreSize: number;
  scored: SpectatorState['scored'];
}) {
  const reduce = useReduceMotion();
  const c = sideColor(index);
  const [pop] = useState(() => new Animated.Value(0));
  const key = scored?.number;
  // Animación breve al sumar: el número late y aparece «+N».
  useEffect(() => {
    if (key == null || reduce) return;
    pop.setValue(1);
    Animated.timing(pop, { toValue: 0, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [key, pop, reduce]);
  const progress = Math.min(1, side.total / target);
  return (
    <View style={[s.card, { borderColor: winner ? colors.warning : c.main }, winner && s.cardWinner]}>
      <Text style={[s.sideName, { color: c.main }]} numberOfLines={1} adjustsFontSizeToFit>
        {winner ? '🏆 ' : ''}
        {side.name}
      </Text>
      {side.members.length > 1 && side.members.join(' y ') !== side.name ? <Text style={s.members}>{side.members.join(' y ')}</Text> : null}
      <Animated.Text style={[s.score, { fontSize: scoreSize, lineHeight: scoreSize * 1.05, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] }]}>
        {side.total}
      </Animated.Text>
      {scored ? (
        <Animated.Text style={[s.plus, { color: c.main, opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] }]}>
          +{scored.points}
        </Animated.Text>
      ) : null}
      <View style={s.track}>
        <View style={[s.fill, { width: `${progress * 100}%`, backgroundColor: c.main }]} />
      </View>
      <Text style={s.remaining}>{side.total >= target ? 'Meta alcanzada' : `Faltan ${target - side.total}`}</Text>
    </View>
  );
}

function Celebration({ headline, detail }: { headline: string; detail: string }) {
  const reduce = useReduceMotion();
  return (
    <View style={s.celebration} pointerEvents="none" accessibilityLiveRegion="assertive">
      {reduce ? null : <Confetti />}
      <View style={s.celebrationCard}>
        <Ionicons name="trophy" size={72} color={colors.warning} />
        <Text style={s.celebrationTitle}>{headline}</Text>
        <Text style={s.celebrationDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waiting: { color: colors.textMuted, fontSize: 22, textAlign: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  badgeText: { fontSize: 16, fontWeight: '700' },
  target: { color: colors.text, fontFamily: fonts.heading, fontSize: 24, flex: 1 },
  fsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  board: { flex: 1, gap: space.lg },
  card: { flex: 1, borderWidth: 3, borderRadius: radius.xl, backgroundColor: colors.scoreCard, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: 4 },
  cardWinner: { shadowColor: colors.warning, shadowOpacity: 0.8, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
  sideName: { fontFamily: fonts.display, fontSize: 44, textAlign: 'center' },
  members: { color: colors.textMuted, fontSize: 20 },
  score: { color: colors.text, fontFamily: fonts.black, textAlign: 'center' },
  plus: { position: 'absolute', top: '30%', right: '12%', fontFamily: fonts.display, fontSize: 48 },
  track: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 10 },
  remaining: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },
  last: { color: colors.textMuted, fontSize: 20, textAlign: 'center' },
  celebration: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  celebrationCard: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceSolid, borderWidth: 2, borderColor: colors.warning, maxWidth: '90%' },
  celebrationTitle: { color: colors.text, fontFamily: fonts.black, fontSize: 56, textAlign: 'center' },
  celebrationDetail: { color: colors.lime, fontFamily: fonts.heading, fontSize: 32, textAlign: 'center' },
});
