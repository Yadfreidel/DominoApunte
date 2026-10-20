// Secciones de Configuración: narrador, y datos sin conexión / sincronización (estado, conflictos).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { NARRATION_LABEL, type NarrationKind, type VoiceOption } from '@/domain/narrator.ts';
import { SYNC_LABEL, syncKind } from '@/domain/syncQueue.ts';
import { narrator } from '@/services/narrator';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { formatDateTime } from './GameSummary';
import { Button, Card, ErrorText, Pill } from './ui';

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={s.toggle}>
      <Text style={[s.toggleLabel, disabled && { opacity: 0.5 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.limeDeep }}
        thumbColor={value ? colors.lime : colors.thumbOff}
        accessibilityLabel={label}
      />
    </View>
  );
}

const VOLUMES = [
  { value: 0.4, label: 'Bajo' },
  { value: 0.7, label: 'Medio' },
  { value: 1, label: 'Alto' },
];
const RATES = [
  { value: 0.85, label: 'Lenta' },
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Rápida' },
];

export function NarratorSection() {
  const store = useStore();
  const n = store.settings.narrator;
  const [voice, setVoice] = useState<VoiceOption | null | undefined>(undefined);
  const update = (patch: Partial<typeof n>) => store.updateSettings({ narrator: { ...n, ...patch } });
  const test = async () => {
    // Desde el toque: también desbloquea el audio del navegador (iPhone).
    narrator.configure({ ...n, enabled: true, muted: false });
    setVoice(await narrator.test());
    narrator.configure(n);
  };

  return (
    <Card style={s.section}>
      <Text style={s.title}>Narrador</Text>
      <Text style={s.meta}>
        Anuncia en voz alta y en pantalla los momentos clave: inicio, cambio de líder, remontadas, cerca de ganar, victoria y avances de
        retos. Usa la voz del teléfono; no envía nombres ni resultados a ningún servicio.
      </Text>
      <Toggle
        label="Activar narrador"
        value={n.enabled}
        onChange={(v) => {
          void update({ enabled: v });
          if (v) void test();
        }}
      />
      <Toggle label="Silenciar (solo anuncios en pantalla)" value={n.muted} onChange={(v) => void update({ muted: v })} disabled={!n.enabled} />
      <Text style={s.label}>Volumen</Text>
      <View style={s.pills}>
        {VOLUMES.map((o) => (
          <Pill key={o.label} label={o.label} active={Math.abs(n.volume - o.value) < 0.05} onPress={() => void update({ volume: o.value })} disabled={!n.enabled} />
        ))}
      </View>
      <Text style={s.label}>Velocidad</Text>
      <View style={s.pills}>
        {RATES.map((o) => (
          <Pill key={o.label} label={o.label} active={Math.abs(n.rate - o.value) < 0.05} onPress={() => void update({ rate: o.value })} disabled={!n.enabled} />
        ))}
      </View>
      <Text style={s.label}>Qué anunciar</Text>
      {(Object.keys(NARRATION_LABEL) as NarrationKind[]).map((k) => (
        <Toggle key={k} label={NARRATION_LABEL[k]} value={n.events[k]} onChange={(v) => void update({ events: { ...n.events, [k]: v } })} disabled={!n.enabled} />
      ))}
      <Button label="Probar voz" icon="volume-high-outline" variant="outline" size="sm" onPress={test} />
      {voice === null ? (
        <Text style={s.warn}>
          Este dispositivo no tiene una voz en español disponible: los anuncios se mostrarán solo en pantalla. Puedes instalar una voz en
          español en los ajustes del teléfono (Accesibilidad → Texto a voz).
        </Text>
      ) : voice ? (
        <Text style={s.meta}>
          Voz: {voice.name} ({voice.lang}){voice.local ? ' · funciona sin internet' : ' · voz en línea: sin internet puede no sonar (los anuncios siguen en pantalla)'}
        </Text>
      ) : null}
    </Card>
  );
}

/** Datos en el dispositivo, funcionamiento sin conexión y estado de la sincronización. */
export function OfflineSection() {
  const store = useStore();
  const { sync, storage, user } = store;
  const signedIn = !!user && !!store.settings.apiUrl;
  const kind = syncKind({ signedIn, syncing: sync.syncing, pending: sync.pending, conflicts: sync.conflicts, offline: sync.offline, lastError: sync.lastError });
  const conflicts = store.games.filter((g) => g.conflict);
  return (
    <Card style={s.section}>
      <Text style={s.title}>Sin conexión y sincronización</Text>
      <Text style={s.meta}>
        Después de abrir la app una vez con internet, puedes crear partidas, anotar, corregir y deshacer manos, terminar partidas, ver el
        historial y jugar retos sin conexión. Cada acción se guarda en este dispositivo antes de mostrarse. Iniciar sesión, grupos,
        temporadas, pantalla grande, contar fichas con la cámara y el panel de administración necesitan conexión.
      </Text>
      <Text style={s.meta}>
        Datos guardados en:{' '}
        {storage === 'indexeddb'
          ? 'este navegador (IndexedDB)'
          : storage === 'nativo'
            ? 'este teléfono'
            : storage === 'localstorage'
              ? 'almacenamiento limitado del navegador (modo privado): puede borrarse al cerrar'
              : '…'}
      </Text>
      {store.storageError ? <ErrorText>{store.storageError}</ErrorText> : null}
      {signedIn ? (
        <View style={s.box}>
          <Text style={[s.meta, { color: kind === 'sincronizado' ? colors.lime : kind === 'error' || kind === 'conflicto' ? colors.danger : colors.warning }]}>
            {SYNC_LABEL[kind]}
            {sync.pending ? ` · ${sync.pending} pendiente(s)` : ''}
            {sync.lastSyncAt ? ` · última vez ${formatDateTime(sync.lastSyncAt)}` : ''}
          </Text>
          {sync.retryAt && !sync.syncing ? <Text style={s.meta}>Próximo reintento automático: {formatDateTime(sync.retryAt)}</Text> : null}
          {sync.lastError ? <ErrorText>{sync.lastError}</ErrorText> : null}
          {sync.lastWarning ? <Text style={s.meta}>Aviso: {sync.lastWarning}</Text> : null}
          {sync.otherAccount ? (
            <Text style={s.meta}>
              {sync.otherAccount} registro(s) de otra cuenta que usó este dispositivo: no se suben con {user!.username}. Se subirán cuando esa
              cuenta inicie sesión aquí.
            </Text>
          ) : null}
          <Button label="Sincronizar ahora" icon="sync" variant="outline" size="sm" onPress={() => store.syncNow()} loading={sync.syncing} />
        </View>
      ) : (
        <Text style={s.meta}>Sin sesión, todo queda solo en este dispositivo.</Text>
      )}
      {conflicts.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={[s.label, { color: colors.danger }]}>Conflictos entre dispositivos</Text>
          {conflicts.map((g) => (
            <Pressable
              key={g.id}
              onPress={async () => {
                await store.resumeGame(g.id);
                router.push('/partida');
              }}
              accessibilityRole="button"
              style={({ pressed }) => [s.conflict, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="git-compare-outline" size={18} color={colors.danger} />
              <Text style={s.toggleLabel} numberOfLines={1}>
                {g.sides.map((sd) => sd.name).join(' vs ')} · {formatDateTime(g.createdAt)}
              </Text>
              <Text style={s.link}>Resolver</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  section: { gap: space.md },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  meta: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  warn: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { color: colors.text, fontSize: 16, flex: 1 },
  box: { gap: space.sm, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: space.md },
  conflict: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: space.md },
  link: { color: colors.danger, fontWeight: '700' },
});
