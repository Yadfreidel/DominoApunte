import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, type TextStyle } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Avatar, PlayerPhotoButton, type VersusSide } from '@/components/Avatar';
import { Disclosure } from '@/components/Disclosure';
import { VersusShowdown } from '@/components/Versus';
import { useDialogs } from '@/components/Dialogs';
import { StarterDraw } from '@/components/StarterDraw';
import { Button, Card, ErrorText, Field, Label, Loading, Pill, Screen, Select, type IconName } from '@/components/ui';
import { DrawError, drawPairs } from '@/domain/draw.ts';
import { coupleName, MAX_NAME_LENGTH, nameKey, normalizeName, parsePoints, parseTarget, validateSetup, type Mode } from '@/domain/game.ts';
import type { SetupDraft } from '@/domain/repository.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';

// En web, Chromium dibuja su anillo de enfoque con outline-style "auto" aunque el ancho sea 0.
// React Native no tipa 'none', por eso la conversión.
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export default function NewGame() {
  const store = useStore();
  const { defaults, knownPlayers, currentGame, photoOf, branding } = store;
  const { toast } = useDialogs();

  // Los valores del organizador son solo sugerencias iniciales: el usuario elige en cada partida.
  const [countChoice, setCountChoice] = useState(2);
  const [modeChoice, setModeChoice] = useState<Mode>(defaults.defaultMode);
  const [passText, setPassText] = useState(defaults.passPoints ? String(defaults.passPoints) : '');
  /** Individual: un nombre por jugador. Parejas: [pareja 1 A, pareja 1 B, pareja 2 A, pareja 2 B]. */
  const [names, setNames] = useState(['', '', '', '']);
  const [teamNames, setTeamNames] = useState<[string, string]>(['', '']);
  const [starterIndex, setStarterIndex] = useState<number | null>(null);
  const [practice, setPractice] = useState(false);
  const [targetPick, setTargetChoice] = useState<number | 'otra'>(defaults.defaultTarget);
  // Campos que el usuario (o su borrador) ya eligió: las sugerencias del organizador no los pisan.
  const [touched, setTouched] = useState({ mode: false, target: false, pass: false });
  const touch = (field: 'mode' | 'target' | 'pass') => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  const [customTarget, setCustomTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const started = useRef(false);

  // Recupera el borrador: los sorteos confirmados no se repiten al recargar.
  const { loadSetupDraft, saveSetupDraft } = store;
  useEffect(() => {
    let alive = true;
    loadSetupDraft().then(
      (d) => {
        if (!alive) return;
        if (d) {
          setModeChoice(d.mode);
          // Los borradores anteriores no indicaban si la modalidad fue elegida: se respeta como elegida.
          setTouched((t) => ({ ...t, mode: d.modeChosen ?? true, pass: t.pass || d.passPoints !== undefined }));
          setCountChoice(d.countChoice);
          setNames(d.names.length === 4 ? d.names : ['', '', '', '']);
          setTeamNames(d.teamNames);
          setStarterIndex(d.starterIndex);
          setPractice(d.practice);
          if (d.passPoints !== undefined) setPassText(d.passPoints ? String(d.passPoints) : '');
        }
        setDraftLoaded(true);
      },
      () => alive && setDraftLoaded(true),
    );
    return () => {
      alive = false;
    };
  }, [loadSetupDraft]);

  useEffect(() => {
    if (!draftLoaded || started.current) return;
    const passPoints = /^\d+$/.test(passText) ? Number(passText) : 0;
    // Solo se guarda lo que el usuario eligió; lo demás sigue las sugerencias del organizador.
    const draft: SetupDraft = {
      mode: modeChoice,
      modeChosen: touched.mode,
      countChoice,
      names,
      teamNames,
      starterIndex,
      practice,
      passPoints: touched.pass ? passPoints : undefined,
    };
    void saveSetupDraft(draft);
  }, [draftLoaded, modeChoice, countChoice, names, teamNames, starterIndex, practice, passText, saveSetupDraft, touched]);

  // La configuración del organizador llega después de abrir la pantalla (se lee del servidor):
  // se aplica a los campos que el usuario todavía no cambió.
  const defaultsKey = `${draftLoaded}|${defaults.defaultMode}|${defaults.defaultTarget}|${defaults.passPoints}`;
  const [appliedDefaults, setAppliedDefaults] = useState(defaultsKey);
  if (draftLoaded && appliedDefaults !== defaultsKey) {
    setAppliedDefaults(defaultsKey);
    if (!touched.mode) setModeChoice(defaults.defaultMode);
    if (!touched.target) setTargetChoice(defaults.defaultTarget);
    if (!touched.pass) setPassText(defaults.passPoints ? String(defaults.passPoints) : '');
  }

  const mode: Mode = modeChoice;
  const count = mode === 'parejas' ? 4 : countChoice;
  const targetChoice =
    targetPick !== 'otra' && !defaults.targets.includes(targetPick) ? defaults.defaultTarget : targetPick;
  const target = targetChoice === 'otra' ? parseTarget(customTarget) : ({ ok: true, value: targetChoice } as const);
  const pass = passText.trim() === '' ? ({ ok: true, value: 0 } as const) : parsePoints(passText);

  const effectiveNames = names.slice(0, count);
  const starter = starterIndex != null && starterIndex < count ? starterIndex : null;
  // Resumen de «Más opciones» para verlo sin abrirlo.
  const moreSummary =
    [
      starter != null && effectiveNames[starter]?.trim() ? `Sale ${effectiveNames[starter].trim()}` : null,
      pass.ok && pass.value > 0 ? `Pase ${pass.value}` : null,
      practice ? 'Práctica' : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  const teamLabel = (pair: 0 | 1) => {
    const members = [names[pair * 2], names[pair * 2 + 1]].map(normalizeName).filter(Boolean);
    return normalizeName(teamNames[pair]) || (members.length ? coupleName(members) : `Pareja ${pair + 1}`);
  };

  const versus: VersusSide[] =
    mode === 'parejas'
      ? ([0, 1] as const).map((pair) => ({
          name: teamLabel(pair),
          members: [names[pair * 2], names[pair * 2 + 1]].map(normalizeName).filter(Boolean),
        }))
      : effectiveNames.map((n, i) => ({ name: n.trim() || `Jugador ${i + 1}`, members: n.trim() ? [n.trim()] : [] }));

  const chooseMode = (m: Mode) => {
    touch('mode');
    setModeChoice(m);
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
    const i = [0, 1, 2, 3].slice(0, count).find((slot) => !names[slot].trim());
    if (i == null) return toast('Todos los lugares están ocupados.', 'info');
    setName(i, name);
  };

  /** Forma las dos parejas al azar con los cuatro jugadores escritos (luego se pueden editar). */
  const drawTeams = () => {
    const filled = names.slice(0, 4).map(normalizeName);
    if (filled.some((n) => !n)) return setError('Escribe los cuatro jugadores antes de sortear las parejas.');
    if (new Set(filled.map(nameKey)).size !== 4) return setError('Hay jugadores repetidos.');
    try {
      const pairs = drawPairs(filled);
      const starterName = starter != null ? filled[starter] : null;
      const next = pairs.flat();
      setNames(next);
      setTeamNames(['', '']);
      setStarterIndex(starterName ? next.indexOf(starterName) : null);
      setError(null);
      toast(`Parejas: ${coupleName(pairs[0])} contra ${coupleName(pairs[1])}`, 'info');
    } catch (err) {
      setError(err instanceof DrawError ? err.message : 'No se pudo sortear.');
    }
  };

  const start = async () => {
    if (!target.ok) return setError(target.error);
    if (!pass.ok) return setError(`Puntos por pase: ${pass.error}`);
    const setup = {
      playerCount: count,
      names: effectiveNames,
      mode,
      target: target.value,
      teamNames: mode === 'parejas' ? teamNames : undefined,
      practice,
      starterIndex: starter,
      rules: pass.value > 0 ? { passPoints: pass.value } : null,
    };
    const problem = validateSetup(setup);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await store.startGame(setup);
      started.current = true;
      await store.saveSetupDraft(null);
      toast('Partida creada. ¡Buena suerte!');
      router.dismissTo('/partida');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la partida.');
    } finally {
      setSaving(false);
    }
  };

  const playerRow = (slot: number, colorIndex: number, label: string, placeholder: string) => (
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
    </View>
  );

  if (!draftLoaded) {
    return (
      <Screen header={<AppHeader subtitle="Nueva partida" />}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader subtitle="Nueva partida" />}>
      {branding.homeText ? (
        <Card style={s.welcome}>
          <Text style={s.welcomeText}>{branding.homeText}</Text>
        </Card>
      ) : null}

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
          color={colors.lime}
          onPress={() => chooseMode('individual')}
        />
        <ModeTile
          icon="people"
          title="Por parejas"
          subtitle="2 parejas · 4 jugadores"
          active={mode === 'parejas'}
          color={colors.purple}
          onPress={() => chooseMode('parejas')}
        />
      </View>

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
          <>
            {([0, 1] as const).map((pair) => {
              const c = sideColor(pair);
              return (
                <View key={pair} style={[s.pair, { borderColor: c.main, backgroundColor: c.soft }]}>
                  <View style={s.pairHeader}>
                    <Ionicons name="people" size={18} color={c.main} />
                    <TextInput
                      value={teamNames[pair]}
                      onChangeText={(t) => setTeamNames((prev) => (pair === 0 ? [t, prev[1]] : [prev[0], t]))}
                      placeholder={teamLabel(pair)}
                      placeholderTextColor={`${c.main}AA`}
                      maxLength={MAX_NAME_LENGTH}
                      accessibilityLabel={`Nombre de la pareja ${pair + 1}`}
                      style={[s.teamInput, { color: c.main }, webNoOutline]}
                    />
                    <Ionicons name="create-outline" size={16} color={`${c.main}AA`} />
                  </View>
                  {playerRow(pair * 2, pair, 'Jugador 1', 'Nombre')}
                  {playerRow(pair * 2 + 1, pair, 'Jugador 2', 'Nombre')}
                </View>
              );
            })}
            <Disclosure icon="shuffle" title="Sortear parejas" accent={colors.purple}>
              <Text style={s.cardHint}>Mezcla a los cuatro jugadores en dos parejas al azar. Puedes editarlas antes de empezar.</Text>
              <Button label="Sortear parejas" icon="shuffle" variant="purple" size="sm" onPress={drawTeams} />
            </Disclosure>
          </>
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
      <VersusShowdown sides={versus} />

      {/* Meta: desplegable */}
      <Disclosure icon="flag-outline" title="Meta por partida" value={target.ok ? `${target.value} puntos` : 'Elige una meta'}>
        <View style={s.wrap}>
          {defaults.targets.map((t) => (
            <Pill
              key={t}
              label={String(t)}
              active={targetChoice === t}
              onPress={() => {
                touch('target');
                setTargetChoice(t);
              }}
            />
          ))}
          <Pill
            label="Otra"
            active={targetChoice === 'otra'}
            onPress={() => {
              touch('target');
              setTargetChoice('otra');
            }}
          />
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
      </Disclosure>

      {/* Opciones poco frecuentes: quién sale, penalización por pase y práctica */}
      <Disclosure icon="options-outline" title="Más opciones" value={moreSummary} accent={colors.purple}>
        <View style={{ gap: space.sm }}>
          <Text style={s.toggleLabel}>¿Quién sale?</Text>
          <StarterDraw names={effectiveNames} value={starter} onResult={setStarterIndex} />
        </View>
        <Field
          label="Puntos por pase (opcional)"
          value={passText}
          onChangeText={(t) => {
            touch('pass');
            setPassText(t.replace(/[^\d]/g, ''));
            setError(null);
          }}
          keyboardType="number-pad"
          placeholder="0 = sin penalización"
          maxLength={4}
          error={!pass.ok ? pass.error : null}
        />
        <Text style={s.cardHint}>
          Si un jugador pasa, se anotan estos puntos al rival con el botón «Pase» del teclado.
          {defaults.passPoints ? ` Sugerido por el organizador: ${defaults.passPoints}.` : ''}
        </Text>
        <View style={s.toggle}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>Partida de práctica</Text>
            <Text style={s.cardHint}>Se guarda en el historial pero no cuenta para estadísticas ni rivales.</Text>
          </View>
          <Switch
            value={practice}
            onValueChange={setPractice}
            trackColor={{ false: colors.border, true: colors.limeDeep }}
            thumbColor={practice ? colors.lime : colors.thumbOff}
            accessibilityLabel="Partida de práctica"
          />
        </View>
      </Disclosure>

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
      <View style={[s.modeIcon, { backgroundColor: active ? color : colors.pressed }]}>
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
    backgroundColor: colors.sheetSoft,
  },
  playerLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  playerInput: { color: colors.text, fontSize: 19, fontWeight: '600', paddingVertical: 6, minHeight: 40 },
  pair: { gap: space.sm, borderWidth: 1.5, borderRadius: radius.lg, padding: space.md },
  pairHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamInput: { flex: 1, fontFamily: fonts.heading, fontSize: 19, minHeight: 36, paddingVertical: 4 },
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
    backgroundColor: colors.field,
  },
  recentText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  versusCard: { gap: space.md, paddingVertical: space.lg },
  versusTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  resume: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  resumeTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  resumeText: { color: colors.textMuted, fontSize: 14 },
  footnote: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  welcome: { paddingVertical: space.md },
  welcomeText: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
