import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Avatar, PlayerPhotoButton, VersusBanner, type VersusSide } from '@/components/Avatar';
import { useDialogs } from '@/components/Dialogs';
import { Button, Card, ErrorText, Field, Label, Pill, Screen, Select, type IconName } from '@/components/ui';
import { coupleName, couples, MAX_NAME_LENGTH, nameKey, parseTarget, validateSetup, type Mode } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';

// En web, Chromium dibuja su anillo de enfoque con outline-style "auto" aunque el ancho sea 0.
// React Native no tipa 'none', por eso la conversión.
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export default function NewGame() {
  const store = useStore();
  const { settings, knownPlayers, currentGame, photoOf } = store;
  const { toast } = useDialogs();

  const individualAllowed = settings.modes.individual;
  const parejasAllowed = settings.modes.parejas;

  const [countChoice, setCountChoice] = useState(2);
  const [modeChoice, setModeChoice] = useState<Mode>('individual');
  /** Individual: un nombre por jugador. Parejas: [pareja 1, compañero 1, pareja 2, compañero 2]. */
  const [names, setNames] = useState(['', '', '', '']);
  const [partnerShown, setPartnerShown] = useState<[boolean, boolean]>([false, false]);
  const [targetPick, setTargetChoice] = useState<number | 'otra'>(settings.defaultTarget);
  const [customTarget, setCustomTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // La selección efectiva respeta siempre las metas y modalidades vigentes (pueden cambiar al sincronizar).
  const mode: Mode = !individualAllowed ? 'parejas' : !parejasAllowed ? 'individual' : modeChoice;
  const count = mode === 'parejas' ? 4 : countChoice;
  const targetChoice =
    targetPick !== 'otra' && !settings.targets.includes(targetPick) ? settings.defaultTarget : targetPick;
  const target = targetChoice === 'otra' ? parseTarget(customTarget) : ({ ok: true, value: targetChoice } as const);

  /** Nombres que realmente se usan (en parejas, el compañero oculto no cuenta). */
  const effectiveNames =
    mode === 'parejas'
      ? [names[0], partnerShown[0] ? names[1] : '', names[2], partnerShown[1] ? names[3] : '']
      : names.slice(0, count);

  const versus: VersusSide[] =
    mode === 'parejas'
      ? couples(effectiveNames).map((members, i) => ({ name: members.length ? coupleName(members) : `Pareja ${i + 1}`, members }))
      : effectiveNames.map((n, i) => ({ name: n.trim() || `Jugador ${i + 1}`, members: n.trim() ? [n.trim()] : [] }));

  const chooseMode = (m: Mode) => {
    setModeChoice(m);
    if (m === 'parejas') setPartnerShown([!!names[1].trim(), !!names[3].trim()]);
    setError(null);
  };

  const setName = (i: number, value: string) => {
    setNames((prev) => prev.map((n, j) => (j === i ? value : n)));
    setError(null);
  };

  const used = new Set(effectiveNames.filter((n) => n.trim()).map(nameKey));
  const suggestions = knownPlayers.filter((n) => !used.has(nameKey(n))).slice(0, 12);

  /** Coloca un jugador reciente en el primer lugar vacío. */
  const fillNext = (name: string) => {
    const slots = mode === 'parejas' ? [0, 2, ...(partnerShown[0] ? [1] : []), ...(partnerShown[1] ? [3] : [])] : [0, 1, 2, 3].slice(0, count);
    const i = slots.find((slot) => !names[slot].trim());
    if (i == null) return toast('Todos los lugares están ocupados.', 'info');
    setName(i, name);
  };

  const togglePartner = (pair: 0 | 1, show: boolean) => {
    setPartnerShown((prev) => (pair === 0 ? [show, prev[1]] : [prev[0], show]));
    if (!show) setName(pair * 2 + 1, '');
  };

  const start = async () => {
    if (!target.ok) return setError(target.error);
    const setup = { playerCount: count, names: effectiveNames, mode, target: target.value };
    const problem = validateSetup(setup);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await store.startGame(setup);
      toast('Partida creada. ¡Buena suerte!');
      router.dismissTo('/partida');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la partida.');
    } finally {
      setSaving(false);
    }
  };

  const playerRow = (slot: number, colorIndex: number, label: string, placeholder: string, onRemove?: () => void) => (
    <View key={slot} style={[s.playerRow, { borderColor: `${sideColor(colorIndex).main}55` }]}>
      <PlayerPhotoButton name={names[slot]} colorIndex={colorIndex} size={52} />
      <View style={{ flex: 1 }}>
        <Text style={[s.playerLabel, { color: sideColor(colorIndex).main }]}>{label}</Text>
        <TextInput
          value={names[slot]}
          onChangeText={(t) => setName(slot, t)}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          selectionColor={colors.lime}
          maxLength={MAX_NAME_LENGTH}
          autoCapitalize="words"
          returnKeyType="next"
          accessibilityLabel={label}
          style={[s.playerInput, webNoOutline]}
        />
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Quitar compañero" hitSlop={8} style={s.remove}>
          <Ionicons name="close-circle" size={24} color={colors.textDim} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Screen header={<AppHeader subtitle="Nueva partida" />}>
      {currentGame?.status === 'pendiente' ? (
        <Card style={s.resume} accent={colors.warning}>
          <Ionicons name="play-circle" size={28} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={s.resumeTitle}>Tienes una partida en curso</Text>
            <Text style={s.resumeText} numberOfLines={1}>
              {currentGame.sides.map((sd) => sd.name).join(' vs ')}
            </Text>
          </View>
          <Button label="Continuar" size="sm" onPress={() => router.dismissTo('/partida')} />
        </Card>
      ) : null}

      {/* Modalidad */}
      <View style={s.modes}>
        <ModeTile
          icon="person"
          title="Individual"
          subtitle="2 a 4 jugadores"
          active={mode === 'individual'}
          disabled={!individualAllowed}
          color={colors.lime}
          onPress={() => chooseMode('individual')}
        />
        <ModeTile
          icon="people"
          title="Por parejas"
          subtitle="2 parejas · 4 jugadores"
          active={mode === 'parejas'}
          disabled={!parejasAllowed}
          color={colors.purple}
          onPress={() => chooseMode('parejas')}
        />
      </View>
      {!parejasAllowed || !individualAllowed ? (
        <Text style={s.hint}>Algunas modalidades fueron deshabilitadas por el administrador.</Text>
      ) : null}

      {/* Jugadores */}
      <Card style={s.section}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>{mode === 'parejas' ? 'Parejas' : 'Jugadores'}</Text>
          <Text style={s.cardHint}>Toca la foto para agregar una</Text>
        </View>

        {mode === 'individual' ? (
          <>
            <Select
              label="Número de jugadores"
              value={count}
              onChange={(n) => {
                setCountChoice(n);
                setError(null);
              }}
              options={[
                { value: 2, label: '2 jugadores' },
                { value: 3, label: '3 jugadores' },
                { value: 4, label: '4 jugadores' },
              ]}
            />
            {Array.from({ length: count }, (_, i) => playerRow(i, i, `Jugador ${i + 1}`, 'Nombre'))}
          </>
        ) : (
          ([0, 1] as const).map((pair) => {
            const c = sideColor(pair);
            return (
              <View key={pair} style={[s.pair, { borderColor: c.main, backgroundColor: c.soft }]}>
                <View style={s.pairHeader}>
                  <Ionicons name="people" size={18} color={c.main} />
                  <Text style={[s.pairTitle, { color: c.main }]}>Pareja {pair + 1}</Text>
                </View>
                {playerRow(pair * 2, pair, 'Jugador', 'Nombre (obligatorio)')}
                {partnerShown[pair] ? (
                  playerRow(pair * 2 + 1, pair, 'Compañero', 'Nombre (opcional)', () => togglePartner(pair, false))
                ) : (
                  <Pressable
                    onPress={() => togglePartner(pair, true)}
                    accessibilityRole="button"
                    style={({ pressed }) => [s.addPartner, { borderColor: `${c.main}88` }, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="person-add-outline" size={18} color={c.main} />
                    <Text style={[s.addPartnerText, { color: c.main }]}>Agregar compañero (opcional)</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        {suggestions.length ? (
          <View>
            <Label>Jugadores recientes</Label>
            <View style={s.wrap}>
              {suggestions.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => fillNext(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`Agregar a ${n}`}
                  style={({ pressed }) => [s.recent, pressed && { opacity: 0.7 }]}
                >
                  <Avatar name={n} colorIndex={0} size={28} photo={photoOf(n)} />
                  <Text style={s.recentText}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      {/* Cara a cara */}
      <Card style={s.versusCard}>
        <Text style={s.versusTitle}>Así se enfrentan</Text>
        <VersusBanner sides={versus} />
      </Card>

      {/* Meta */}
      <Card style={s.section}>
        <Text style={s.cardTitle}>Meta de la partida</Text>
        <View style={s.wrap}>
          {settings.targets.map((t) => (
            <Pill key={t} label={String(t)} active={targetChoice === t} onPress={() => setTargetChoice(t)} />
          ))}
          <Pill label="Otra" active={targetChoice === 'otra'} onPress={() => setTargetChoice('otra')} />
        </View>
        {targetChoice === 'otra' ? (
          <Field
            label="Meta personalizada"
            value={customTarget}
            onChangeText={(t) => {
              setCustomTarget(t.replace(/[^\d]/g, ''));
              setError(null);
            }}
            keyboardType="number-pad"
            placeholder="Ej.: 250"
            maxLength={5}
            error={customTarget && !target.ok ? target.error : null}
          />
        ) : null}
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        label={`Iniciar partida${target.ok ? ` a ${target.value}` : ''}`}
        icon="play"
        size="lg"
        onPress={start}
        loading={saving}
      />
      <Text style={s.footnote}>Todos los marcadores comienzan en cero.</Text>
    </Screen>
  );
}

function ModeTile({
  icon,
  title,
  subtitle,
  active,
  disabled,
  color,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  active: boolean;
  disabled?: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [
        s.modeTile,
        active && { borderColor: color, backgroundColor: `${color}1F`, shadowColor: color, shadowOpacity: 0.5 },
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[s.modeIcon, { backgroundColor: active ? color : 'rgba(255,255,255,0.06)' }]}>
        <Ionicons name={icon} size={24} color={active ? colors.onLime : colors.textMuted} />
      </View>
      <Text style={[s.modeTitle, active && { color }]}>{title}</Text>
      <Text style={s.modeSubtitle}>{subtitle}</Text>
      {active ? <Ionicons name="checkmark-circle" size={20} color={color} style={s.modeCheck} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  section: { gap: space.md },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  cardTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  cardHint: { color: colors.textDim, fontSize: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  modes: { flexDirection: 'row', gap: space.md },
  modeTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
  },
  modeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  modeTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 21 },
  modeSubtitle: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  modeCheck: { position: 'absolute', top: 10, right: 10 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: 'rgba(5, 10, 36, 0.75)',
  },
  playerLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  playerInput: { color: colors.text, fontSize: 19, fontWeight: '600', paddingVertical: 6, minHeight: 40 },
  remove: { padding: 4 },
  pair: { gap: space.sm, borderWidth: 1.5, borderRadius: radius.lg, padding: space.md },
  pairHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pairTitle: { fontFamily: fonts.heading, fontSize: 19 },
  addPartner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addPartnerText: { fontSize: 15, fontWeight: '700' },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    paddingRight: space.md,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(8, 14, 48, 0.7)',
  },
  recentText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  versusCard: { gap: space.md, paddingVertical: space.lg },
  versusTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
  resume: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  resumeTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  resumeText: { color: colors.textMuted, fontSize: 14 },
  footnote: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
