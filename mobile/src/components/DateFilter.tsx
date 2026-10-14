import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { localDateKey } from '@/domain/game.ts';
import { space } from '@/theme';
import { Field, Label, Pill } from './ui';

export interface DateRange {
  from?: string;
  to?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateKey(d.toISOString());
}

type Preset = 'todo' | 'hoy' | '7' | '30' | 'rango';

/** Filtro de fechas con atajos y rango personalizado (AAAA-MM-DD). */
export function DateFilter({ onChange }: { onChange: (range: DateRange) => void }) {
  const [preset, setPreset] = useState<Preset>('todo');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const choose = (p: Preset) => {
    setPreset(p);
    if (p === 'todo') onChange({});
    if (p === 'hoy') onChange({ from: daysAgo(0), to: daysAgo(0) });
    if (p === '7') onChange({ from: daysAgo(6) });
    if (p === '30') onChange({ from: daysAgo(29) });
    if (p === 'rango') onChange({ from: DATE_RE.test(from) ? from : undefined, to: DATE_RE.test(to) ? to : undefined });
  };

  const update = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    onChange({ from: DATE_RE.test(nextFrom) ? nextFrom : undefined, to: DATE_RE.test(nextTo) ? nextTo : undefined });
  };

  const clean = (t: string) => t.replace(/[^\d-]/g, '').slice(0, 10);
  const invalid = (v: string) => (v && !DATE_RE.test(v) ? 'Usa el formato AAAA-MM-DD' : null);

  return (
    <View style={{ gap: space.sm }}>
      <Label>Fecha</Label>
      <View style={s.row}>
        <Pill label="Todo" active={preset === 'todo'} onPress={() => choose('todo')} />
        <Pill label="Hoy" active={preset === 'hoy'} onPress={() => choose('hoy')} />
        <Pill label="7 días" active={preset === '7'} onPress={() => choose('7')} />
        <Pill label="30 días" active={preset === '30'} onPress={() => choose('30')} />
        <Pill label="Rango" active={preset === 'rango'} onPress={() => choose('rango')} />
      </View>
      {preset === 'rango' ? (
        <View style={s.row}>
          <View style={s.half}>
            <Field label="Desde" value={from} placeholder="2026-10-01" onChangeText={(t) => update(clean(t), to)} error={invalid(from)} />
          </View>
          <View style={s.half}>
            <Field label="Hasta" value={to} placeholder="2026-10-31" onChangeText={(t) => update(from, clean(t))} error={invalid(to)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  half: { flex: 1, minWidth: 140 },
});
