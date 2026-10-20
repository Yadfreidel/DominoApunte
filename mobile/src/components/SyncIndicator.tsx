// Estado de guardado y sincronización, discreto, bajo la cabecera de cada pantalla:
// sin conexión · pendiente · sincronizando · sincronizado · error (con «Reintentar») · conflicto.
// Si falla el almacenamiento del dispositivo, lo avisa en rojo (la acción no quedó guardada).
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SYNC_LABEL, syncKind, type SyncKind } from '@/domain/syncQueue.ts';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, radius, space } from '@/theme';
import type { IconName } from './ui';

const ICON: Record<SyncKind, IconName> = {
  local: 'phone-portrait-outline',
  'sin-conexion': 'cloud-offline-outline',
  pendiente: 'cloud-upload-outline',
  sincronizando: 'sync-outline',
  sincronizado: 'cloud-done-outline',
  error: 'alert-circle-outline',
  conflicto: 'git-compare-outline',
};

export function SyncIndicator() {
  const store = useStore();
  const goTo = useGoTo();
  const { sync, storageError } = store;
  if (storageError) {
    return (
      <View style={[s.pill, s.danger]} accessibilityRole="alert">
        <Ionicons name="warning-outline" size={15} color={colors.danger} />
        <Text style={[s.text, { color: colors.danger }]} numberOfLines={2}>
          {storageError}
        </Text>
      </View>
    );
  }
  const signedIn = !!store.user && !!store.settings.apiUrl;
  const kind = syncKind({ signedIn, syncing: sync.syncing, pending: sync.pending, conflicts: sync.conflicts, offline: sync.offline, lastError: sync.lastError });
  if (kind === 'local') return null;
  const color =
    kind === 'error' || kind === 'conflicto' ? colors.danger : kind === 'sin-conexion' || kind === 'pendiente' ? colors.warning : kind === 'sincronizado' ? colors.lime : colors.textMuted;
  const detail = kind === 'pendiente' || kind === 'sin-conexion' ? ` (${sync.pending})` : '';
  const action = kind === 'error' || kind === 'sin-conexion' || kind === 'pendiente' ? 'Reintentar' : kind === 'conflicto' ? 'Resolver' : null;
  const onPress = () => {
    if (kind === 'conflicto') goTo('/configuracion');
    else void store.syncNow();
  };
  return (
    <Pressable
      onPress={action ? onPress : undefined}
      disabled={!action}
      accessibilityRole={action ? 'button' : 'text'}
      accessibilityLabel={`${SYNC_LABEL[kind]}${detail}${action ? `. ${action}` : ''}`}
      style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]}
    >
      {kind === 'sincronizando' ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={ICON[kind]} size={15} color={color} />}
      <Text style={[s.text, { color }]} numberOfLines={1}>
        {SYNC_LABEL[kind]}
        {detail}
      </Text>
      {action ? <Text style={[s.action, { color }]}>{action}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    maxWidth: '94%',
    minHeight: 28,
  },
  danger: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.danger },
  text: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  action: { fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
});
