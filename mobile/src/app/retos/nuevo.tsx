import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Button, Card, ErrorText, Field, Label, Screen, Select } from '@/components/ui';
import { challengeRulesText, validateChallengeInput, type ChallengeInput, type ChallengeKind, type TiePolicy } from '@/domain/challenge.ts';
import { parsePoints, type Mode } from '@/domain/game.ts';
import { deviceTimeZone } from '@/domain/groups.ts';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';

/** Próximo fin de semana (o el actual si hoy es sábado o domingo), en la hora del dispositivo. */
function weekend(): [string, string] {
  const d = new Date();
  const day = d.getDay(); // 0 domingo … 6 sábado
  const toSat = day === 6 ? 0 : day === 0 ? -1 : 6 - day;
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toSat);
  const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return [fmt(sat), fmt(sun)];
}

type Players = 'i2' | 'i3' | 'i4' | 'parejas';

export default function NewChallenge() {
  const store = useStore();
  const { defaults } = store;
  const { toast } = useDialogs();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChallengeKind>('primero');
  const [players, setPlayers] = useState<Players>('parejas');
  const [names, setNames] = useState<string[]>(['', '', '', '']);
  const [teams, setTeams] = useState<[string, string]>(['', '']);
  const [target, setTarget] = useState(defaults.defaultTarget);
  const [pass, setPass] = useState(String(defaults.passPoints));
  const [wins, setWins] = useState(3);
  const [[from, to], setDates] = useState<[string, string]>(weekend);
  const [tiePolicy, setTiePolicy] = useState<TiePolicy>('empate');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timeZone = deviceTimeZone();

  const mode: Mode = players === 'parejas' ? 'parejas' : 'individual';
  const count = players === 'parejas' ? 4 : Number(players.slice(1));
  const passParsed = parsePoints(pass === '' ? '0' : pass);
  const input: ChallengeInput = {
    name,
    kind,
    mode,
    names: names.slice(0, count),
    teamNames: mode === 'parejas' ? teams : undefined,
    target,
    rules: passParsed.ok && passParsed.value > 0 ? { passPoints: passParsed.value } : null,
    winsNeeded: kind === 'primero' ? wins : null,
    startsOn: kind === 'serie' ? from.trim() : null,
    endsOn: kind === 'serie' ? to.trim() : null,
    timeZone,
    tiePolicy,
  };
  const problem = !passParsed.ok ? passParsed.error : validateChallengeInput(input);

  const create = async () => {
    if (busy) return;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const ch = await store.createChallenge(input);
      toast('Reto creado');
      router.replace({ pathname: '/retos/[id]', params: { id: ch.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el reto.');
    } finally {
      setBusy(false);
    }
  };

  const setName_ = (i: number, v: string) => setNames((prev) => prev.map((x, k) => (k === i ? v : x)));
  const label = (i: number) => (mode === 'parejas' ? `Pareja ${Math.floor(i / 2) + 1} · jugador ${(i % 2) + 1}` : `Jugador ${i + 1}`);

  return (
    <Screen header={<AppHeader subtitle="Nuevo reto" />}>
      <Card style={s.section}>
        <Field label="Nombre del reto" value={name} onChangeText={setName} placeholder="Ej.: Revancha del viernes" maxLength={40} />
        <Select<ChallengeKind>
          label="Modalidad"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'primero', label: 'Primero en ganar N partidas', hint: 'Ej.: la primera pareja en conseguir 3 victorias' },
            { value: 'serie', label: 'Serie por período', hint: 'Ej.: serie del fin de semana; gana quien tenga más victorias' },
          ]}
        />
        {kind === 'primero' ? (
          <Select<number>
            label="Victorias necesarias"
            value={wins}
            onChange={setWins}
            options={[1, 2, 3, 4, 5, 7, 10].map((n) => ({ value: n, label: `${n} ${n === 1 ? 'victoria' : 'victorias'}` }))}
          />
        ) : (
          <>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Field label="Desde (AAAA-MM-DD)" value={from} onChangeText={(v) => setDates([v, to])} maxLength={10} autoCapitalize="none" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Hasta (AAAA-MM-DD)" value={to} onChangeText={(v) => setDates([from, v])} maxLength={10} autoCapitalize="none" />
              </View>
            </View>
            <Select<TiePolicy>
              label="Si hay empate al cierre"
              value={tiePolicy}
              onChange={setTiePolicy}
              options={[
                { value: 'empate', label: 'Se permite el empate' },
                { value: 'puntos', label: 'Desempata quien sumó más puntos' },
              ]}
            />
          </>
        )}
      </Card>

      <Card style={s.section}>
        <Text style={s.title}>Participantes (fijos durante el reto)</Text>
        <Select<Players>
          label="Jugadores"
          value={players}
          onChange={setPlayers}
          options={[
            { value: 'parejas', label: 'Por parejas (2 parejas)' },
            { value: 'i2', label: 'Individual · 2 jugadores' },
            { value: 'i3', label: 'Individual · 3 jugadores' },
            { value: 'i4', label: 'Individual · 4 jugadores' },
          ]}
        />
        {names.slice(0, count).map((v, i) => (
          <Field key={`${mode}-${i}`} label={label(i)} value={v} onChangeText={(t) => setName_(i, t)} maxLength={24} />
        ))}
        {mode === 'parejas' ? (
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Field label="Nombre pareja 1 (opcional)" value={teams[0]} onChangeText={(v) => setTeams([v, teams[1]])} maxLength={24} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Nombre pareja 2 (opcional)" value={teams[1]} onChangeText={(v) => setTeams([teams[0], v])} maxLength={24} />
            </View>
          </View>
        ) : null}
      </Card>

      <Card style={s.section}>
        <Text style={s.title}>Reglas de cada partida</Text>
        <Select<number> label="Meta por partida" value={target} onChange={setTarget} options={defaults.targets.map((t) => ({ value: t, label: `${t} puntos` }))} />
        <Field label="Puntos por pase (0 = sin penalización)" value={pass} onChangeText={setPass} keyboardType="number-pad" maxLength={4} />
      </Card>

      <Card style={s.section}>
        <Label>Así funcionará</Label>
        {challengeRulesText({
          kind,
          winsNeeded: wins,
          startsOn: from,
          endsOn: to,
          timeZone,
          tiePolicy,
          target,
          rules: input.rules ?? null,
        }).map((t) => (
          <Text key={t} style={s.meta}>
            • {t}
          </Text>
        ))}
        <Text style={s.meta}>
          • Las partidas se asocian al reto al empezarlas desde su pantalla («Jugar partida del reto»). Las partidas anteriores no se incorporan.
        </Text>
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Crear reto" icon="flag" size="lg" onPress={create} loading={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { gap: space.md },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 21 },
  meta: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space.sm },
});
