import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Button, Card, ErrorText, Field, Label, Pill, Screen } from '@/components/ui';
import { DrawError, drawPairs } from '@/domain/draw.ts';
import { coupleName, MAX_NAME_LENGTH, nameKey, normalizeName, parseTarget, type Mode } from '@/domain/game.ts';
import { MAX_ENTRANTS, MIN_ENTRANTS } from '@/domain/tournament.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';

interface Team {
  name: string;
  players: [string, string];
}

export default function NewTournament() {
  const store = useStore();
  const { settings, knownPlayers } = store;
  const { toast } = useDialogs();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('individual');
  const [targetPick, setTargetPick] = useState<number | 'otra'>(settings.defaultTarget);
  const [customTarget, setCustomTarget] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  /** Parejas sorteadas y editadas; null hasta sortear. */
  const [teams, setTeams] = useState<Team[] | null>(null);
  /** Jugador seleccionado para intercambiar: [pareja, posición]. */
  const [swapFrom, setSwapFrom] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const target = targetPick === 'otra' ? parseTarget(customTarget) : ({ ok: true, value: targetPick } as const);
  const used = new Set(people.map(nameKey));
  const suggestions = knownPlayers.filter((n) => !used.has(nameKey(n))).slice(0, 16);
  const maxPeople = mode === 'parejas' ? MAX_ENTRANTS * 2 : MAX_ENTRANTS;

  const addPerson = (raw: string) => {
    const n = normalizeName(raw);
    if (!n) return;
    if (n.length > MAX_NAME_LENGTH) return setError(`Los nombres no pueden superar ${MAX_NAME_LENGTH} caracteres.`);
    if (used.has(nameKey(n))) return setError(`${n} ya está en la lista.`);
    if (people.length >= maxPeople) return setError(`El máximo es ${maxPeople} jugadores.`);
    setPeople((p) => [...p, n]);
    setTeams(null);
    setNewName('');
    setError(null);
  };

  const removePerson = (n: string) => {
    setPeople((p) => p.filter((x) => x !== n));
    setTeams(null);
  };

  const drawTeams = () => {
    try {
      const pairs = drawPairs(people);
      setTeams(pairs.map((pair) => ({ name: '', players: pair })));
      setSwapFrom(null);
      setError(null);
    } catch (err) {
      setError(err instanceof DrawError ? err.message : 'No se pudo sortear.');
    }
  };

  /** Toca un jugador y luego otro para intercambiarlos entre parejas. */
  const tapPlayer = (team: number, pos: number) => {
    if (!teams) return;
    if (!swapFrom) return setSwapFrom([team, pos]);
    const [t0, p0] = swapFrom;
    setSwapFrom(null);
    if (t0 === team && p0 === pos) return;
    const next = teams.map((t) => ({ ...t, players: [...t.players] as [string, string] }));
    const a = next[t0].players[p0];
    next[t0].players[p0] = next[team].players[pos];
    next[team].players[pos] = a;
    setTeams(next);
  };

  const confirm = async () => {
    if (!normalizeName(name)) return setError('Escribe el nombre del torneo.');
    if (!target.ok) return setError(target.error);
    let entrants: { name?: string; players: { name: string; playerId: string }[] }[];
    if (mode === 'parejas') {
      if (!teams) return setError(people.length % 2 ? 'La cantidad de jugadores debe ser par para formar parejas.' : 'Sortea las parejas antes de confirmar.');
      if (teams.length < MIN_ENTRANTS) return setError(`Se necesitan al menos ${MIN_ENTRANTS} parejas (4 jugadores).`);
      entrants = teams.map((t) => ({ name: t.name, players: t.players.map((p) => ({ name: p, playerId: '' })) }));
    } else {
      if (people.length < MIN_ENTRANTS) return setError(`Se necesitan al menos ${MIN_ENTRANTS} jugadores.`);
      entrants = people.map((p) => ({ players: [{ name: p, playerId: '' }] }));
    }
    setSaving(true);
    setError(null);
    try {
      const t = await store.createTournament({ name, mode, target: target.value, entrants });
      toast('Torneo creado y cruces sorteados');
      router.replace({ pathname: '/torneos/[id]', params: { id: t.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el torneo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Nuevo torneo" />}>
      <Button label="Volver a torneos" icon="arrow-back" variant="ghost" size="sm" onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Card style={s.section}>
        <Field label="Nombre del torneo" value={name} onChangeText={setName} placeholder="Ej.: Copa de verano" maxLength={40} />
        <View>
          <Label>Modalidad</Label>
          <View style={s.wrap}>
            <Pill
              label="Individual"
              active={mode === 'individual'}
              disabled={!settings.modes.individual}
              onPress={() => {
                setMode('individual');
                setTeams(null);
              }}
            />
            <Pill
              label="Por parejas"
              color={colors.purple}
              active={mode === 'parejas'}
              disabled={!settings.modes.parejas}
              onPress={() => {
                setMode('parejas');
                setTeams(null);
              }}
            />
          </View>
        </View>
        <View>
          <Label>Meta de cada partida</Label>
          <View style={s.wrap}>
            {settings.targets.map((t) => (
              <Pill key={t} label={String(t)} active={targetPick === t} onPress={() => setTargetPick(t)} />
            ))}
            <Pill label="Otra" active={targetPick === 'otra'} onPress={() => setTargetPick('otra')} />
          </View>
          {targetPick === 'otra' ? (
            <Field
              value={customTarget}
              onChangeText={(t) => setCustomTarget(t.replace(/[^\d]/g, ''))}
              keyboardType="number-pad"
              placeholder="Ej.: 250"
              maxLength={5}
              error={customTarget && !target.ok ? target.error : null}
            />
          ) : null}
        </View>
      </Card>

      <Card style={s.section}>
        <Text style={s.title}>Participantes ({people.length})</Text>
        <View style={s.addRow}>
          <View style={{ flex: 1 }}>
            <Field value={newName} onChangeText={setNewName} placeholder="Nombre del jugador" maxLength={MAX_NAME_LENGTH} onSubmitEditing={() => addPerson(newName)} />
          </View>
          <Button label="Agregar" icon="add" variant="outline" onPress={() => addPerson(newName)} />
        </View>
        {people.length ? (
          <View style={s.wrap}>
            {people.map((p) => (
              <Pressable key={p} onPress={() => removePerson(p)} accessibilityRole="button" accessibilityLabel={`Quitar a ${p}`} style={s.person}>
                <Text style={s.personText}>{p}</Text>
                <Ionicons name="close" size={16} color={colors.textDim} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={s.muted}>Agrega al menos {mode === 'parejas' ? '4 jugadores (2 parejas)' : '2 jugadores'}.</Text>
        )}
        {suggestions.length ? (
          <View>
            <Label>Jugadores registrados</Label>
            <View style={s.wrap}>
              {suggestions.map((n) => (
                <Pill key={n} label={`+ ${n}`} active={false} onPress={() => addPerson(n)} />
              ))}
            </View>
          </View>
        ) : null}
        {mode === 'parejas' ? (
          <>
            <Button
              label={teams ? 'Volver a sortear parejas' : 'Sortear parejas'}
              icon="shuffle"
              onPress={drawTeams}
              disabled={people.length < 4}
            />
            {people.length % 2 === 1 ? <Text style={s.warn}>Hay {people.length} jugadores: la cantidad debe ser par.</Text> : null}
          </>
        ) : null}
      </Card>

      {mode === 'parejas' && teams ? (
        <Card style={s.section}>
          <Text style={s.title}>Parejas sorteadas</Text>
          <Text style={s.muted}>Toca un jugador y luego otro para intercambiarlos. Puedes ponerle nombre a cada pareja.</Text>
          {teams.map((t, i) => {
            const c = sideColor(i % 4);
            return (
              <View key={i} style={[s.team, { borderColor: `${c.main}88` }]}>
                <Field
                  value={t.name}
                  onChangeText={(v) => setTeams((prev) => prev!.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                  placeholder={coupleName(t.players)}
                  maxLength={MAX_NAME_LENGTH}
                />
                <View style={s.wrap}>
                  {t.players.map((p, pos) => {
                    const selected = swapFrom?.[0] === i && swapFrom?.[1] === pos;
                    return (
                      <Pressable
                        key={pos}
                        onPress={() => tapPlayer(i, pos)}
                        accessibilityRole="button"
                        accessibilityLabel={selected ? `${p}, seleccionado para intercambiar` : `Intercambiar a ${p}`}
                        style={[s.member, selected && { borderColor: colors.lime, backgroundColor: colors.limeSoft }]}
                      >
                        <Ionicons name="swap-horizontal" size={14} color={selected ? colors.lime : colors.textDim} />
                        <Text style={s.personText}>{p}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Confirmar y sortear cruces" icon="checkmark" size="lg" onPress={confirm} loading={saving} />
      <Text style={s.muted}>
        Eliminación directa. Si la cantidad no es potencia de dos (2, 4, 8, 16…), algunos reciben un pase automático en la primera ronda.
        {mode === 'parejas' ? ' Las parejas quedan fijas durante todo el torneo.' : ''}
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { gap: space.md },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 21 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.field,
  },
  personText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  team: { gap: space.sm, borderWidth: 1.5, borderRadius: radius.lg, padding: space.md },
  muted: { color: colors.textDim, fontSize: 13 },
  warn: { color: colors.warning, fontSize: 13 },
});
