import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { STATE_STYLE } from '@/components/challengeStyle';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime, GameSummary } from '@/components/GameSummary';
import { Button, Card, EmptyState, ErrorText, Screen, Select } from '@/components/ui';
import {
  cannotStart,
  CHALLENGE_STATE_LABEL,
  challengeProgress,
  challengeRulesText,
  MAX_WINS_NEEDED,
  seriesScore,
  VERDICT_LABEL,
} from '@/domain/challenge.ts';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const goTo = useGoTo();
  const { confirm, toast } = useDialogs();
  const [openedAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ch = store.challenges.find((c) => c.id === id);
  const [reopenTo, setReopenTo] = useState<number | null>(null);
  const refreshRef = useRef(store.refreshChallenge);
  useEffect(() => {
    refreshRef.current = store.refreshChallenge;
  });

  // Al abrirlo se registra (una vez) un resultado que haya cambiado, p. ej. una serie cuyo período ya cerró.
  useEffect(() => {
    if (id) void refreshRef.current(id).catch(() => undefined);
  }, [id]);

  if (!ch) {
    return (
      <Screen header={<AppHeader subtitle="Reto" />}>
        <EmptyState icon="flag-outline" title="El reto no existe" message="Puede que se haya creado en otro dispositivo." action={<Button label="Ver retos" onPress={() => goTo('/retos')} />} />
      </Screen>
    );
  }
  const p = challengeProgress(ch, store.games, openedAt);
  const st = STATE_STYLE[p.state];
  const score = seriesScore(ch, p);
  const blocked = cannotStart(ch, p);
  const otherAccount = ch.accountId != null && store.user != null && ch.accountId !== store.user.id;
  const signedIn = !!store.user && !!store.settings.apiUrl;
  const winners = p.winnerIds.map((wid) => ch.entrants.find((e) => e.id === wid)?.name).filter(Boolean) as string[];
  const best = Math.max(0, ...p.rows.map((r) => r.wins));
  const reopenOptions = Array.from({ length: Math.min(5, MAX_WINS_NEEDED - best) }, (_, i) => best + 1 + i);

  const play = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.startChallengeGame(ch.id, null);
      goTo('/partida');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar la partida.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const ok = await confirm({ title: `¿Cancelar ${ch.name}?`, message: 'No habrá ganador y no admitirá más partidas. Sus partidas siguen en el historial.', confirmLabel: 'Cancelar reto', destructive: true });
    if (!ok) return;
    await store.cancelChallenge(ch.id);
    toast('Reto cancelado', 'info');
  };
  const reopen = async () => {
    const n = reopenTo ?? reopenOptions[0];
    const ok = await confirm({ title: '¿Reabrir el reto?', message: `Ahora ganará quien llegue a ${n} victorias. Quedará registrado en el historial del reto.`, confirmLabel: 'Reabrir' });
    if (!ok) return;
    try {
      await store.reopenChallenge(ch.id, n);
      toast('Reto reabierto');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo reabrir.', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Reto" />}>
      <Button label="Retos" icon="arrow-back" variant="ghost" size="sm" onPress={() => goTo('/retos')} style={{ alignSelf: 'flex-start' }} />
      <Card style={{ gap: 6 }}>
        <View style={s.top}>
          <Text style={s.title}>{ch.name}</Text>
          <View style={[s.badge, { borderColor: st.color }]}>
            <Ionicons name={st.icon} size={13} color={st.color} />
            <Text style={[s.badgeText, { color: st.color }]}>{CHALLENGE_STATE_LABEL[p.state]}</Text>
          </View>
        </View>
        <Text style={s.meta}>
          {ch.kind === 'primero' ? `Primero en ganar ${ch.winsNeeded} partidas` : `Serie del ${ch.startsOn} al ${ch.endsOn} · hora de ${ch.timeZone}`}
        </Text>
        {score && !p.decided ? <Text style={s.score}>Serie {score}</Text> : null}
      </Card>

      {p.decided && winners.length ? (
        <Card accent={colors.warning} style={s.champion}>
          <Ionicons name="trophy" size={44} color={colors.warning} />
          <Text style={s.championLabel}>{p.tie ? 'EMPATE' : winners.length > 1 || ch.mode === 'parejas' ? 'CAMPEONES DEL RETO' : 'CAMPEÓN DEL RETO'}</Text>
          <Text style={s.championName}>{winners.join(' · ')}</Text>
        </Card>
      ) : null}

      <Card style={{ paddingHorizontal: space.sm }}>
        <View style={[s.row, s.border]}>
          <Text style={[s.name, s.th]}>{ch.mode === 'parejas' ? 'Pareja' : 'Jugador'}</Text>
          <Text style={[s.num, s.th]}>PJ</Text>
          <Text style={[s.num, s.th]}>G</Text>
          <Text style={[s.pts, s.th]}>Puntos</Text>
        </View>
        {p.rows.map((r, i) => (
          <View
            key={r.entrantId}
            style={[s.row, i < p.rows.length - 1 && s.border]}
            accessible
            accessibilityLabel={`${r.name}: ${r.wins} victorias en ${r.played} partidas, ${r.points} puntos`}
          >
            <Text style={s.name} numberOfLines={2}>
              {r.name}
            </Text>
            <Text style={s.num}>{r.played}</Text>
            <Text style={[s.num, { color: colors.lime }]}>{r.wins}</Text>
            <Text style={s.pts}>{r.points}</Text>
          </View>
        ))}
      </Card>

      {otherAccount ? (
        <Text style={s.warn}>Este reto se creó con otra cuenta en este dispositivo: solo se puede consultar.</Text>
      ) : blocked ? (
        <Text style={s.meta}>{blocked}</Text>
      ) : (
        <Button label="Jugar partida del reto" icon="play" size="lg" onPress={play} loading={busy} />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Card style={{ gap: 4 }}>
        <Text style={s.rowTitle}>Reglas</Text>
        {challengeRulesText(ch).map((t) => (
          <Text key={t} style={s.meta}>
            • {t}
          </Text>
        ))}
      </Card>

      <Text style={s.subTitle}>Partidas del reto</Text>
      {p.games.length === 0 ? <Text style={s.meta}>Todavía no hay partidas.</Text> : null}
      {[...p.games].reverse().map(({ game, verdict }) => {
        const provisional = signedIn && store.syncedRevisions[game.id] !== game.revision;
        return (
          <View key={game.id} style={{ gap: 4 }}>
            <GameSummary game={game} onPress={() => router.push({ pathname: '/historial/[id]', params: { id: game.id } })} />
            <Text style={[s.verdict, { color: verdict === 'cuenta' ? colors.lime : colors.textDim }]}>
              {VERDICT_LABEL[verdict]}
              {provisional && verdict === 'cuenta' ? ' · provisional (pendiente de sincronizar)' : ''}
            </Text>
          </View>
        );
      })}

      {ch.log.length ? (
        <Card style={{ gap: 4 }}>
          <Text style={s.rowTitle}>Historial del reto</Text>
          {[...ch.log].reverse().map((l, i) => (
            <Text key={`${l.at}-${i}`} style={s.meta}>
              {formatDateTime(l.at)} · {l.text}
            </Text>
          ))}
        </Card>
      ) : null}

      {!otherAccount && p.state === 'completado' && ch.kind === 'primero' && reopenOptions.length ? (
        <Card style={{ gap: space.sm }}>
          <Text style={s.rowTitle}>Reabrir el reto</Text>
          <Text style={s.meta}>Sube las victorias necesarias para seguir jugando. El ganador actual deja de estar declarado.</Text>
          <Select<number>
            label="Nuevas victorias necesarias"
            value={reopenTo ?? reopenOptions[0]}
            onChange={setReopenTo}
            options={reopenOptions.map((n) => ({ value: n, label: `${n} victorias` }))}
          />
          <Button label="Reabrir" icon="refresh" variant="outline" onPress={reopen} />
        </Card>
      ) : null}
      {!otherAccount && ch.status !== 'cancelado' && !p.decided ? (
        <Button label="Cancelar reto" variant="ghost" size="sm" icon="close-circle-outline" onPress={cancel} />
      ) : null}
      {!signedIn ? <Text style={s.hint}>Sin sesión, el reto existe solo en este dispositivo. Con sesión se guarda también en el servidor.</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, color: colors.text, fontFamily: fonts.heading, fontSize: 28 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  score: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
  subTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 21, marginTop: space.sm },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  warn: { color: colors.warning, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  verdict: { fontSize: 12, fontWeight: '700', paddingHorizontal: space.sm },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  champion: { alignItems: 'center', gap: 4 },
  championLabel: { color: colors.warning, fontFamily: fonts.black, fontSize: 18, letterSpacing: 3 },
  championName: { color: colors.text, fontFamily: fonts.display, fontSize: 30, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 4 },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  th: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600', paddingLeft: space.sm },
  num: { width: 36, textAlign: 'center', color: colors.text, fontSize: 15, fontWeight: '700' },
  pts: { width: 64, textAlign: 'center', color: colors.text, fontSize: 15, fontWeight: '700' },
});
