// Piezas comunes del panel de administración.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Correction } from '@/services/api';
import { colors, fonts, radius, space } from '@/theme';
import { formatDateTime } from '../GameSummary';
import { Button, EmptyState, Field, Loading, type IconName } from '../ui';

export const errorMessage = (err: unknown, fallback = 'No se pudo completar la acción.') => (err instanceof Error ? err.message : fallback);

export function QueryState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (loading) return <Loading />;
  if (error) {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="No se pudo cargar"
        message={error}
        action={<Button label="Reintentar" icon="refresh" variant="outline" onPress={reload} />}
      />
    );
  }
  return null;
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={as.sectionHeader}>
      <View style={{ flex: 1, minWidth: 200 }}>
        <Text style={as.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={as.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Kpi({ icon, label, value, color }: { icon: IconName; label: string; value: number; color: string }) {
  return (
    <View style={[as.kpi, { borderColor: `${color}55` }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={[as.kpiIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[as.kpiValue, { color }]}>{value}</Text>
      <Text style={as.kpiLabel}>{label}</Text>
    </View>
  );
}

export function IconAction({
  icon,
  label,
  onPress,
  color = colors.textMuted,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [as.iconAction, pressed && { backgroundColor: colors.pressed }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

/** Texto con espera: devuelve el valor cuando el usuario deja de escribir. */
export function useDebounced(value: string, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <Field value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={placeholder} autoCapitalize="none" />;
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <Text style={[as.muted, { textAlign: 'center' }]}>{total} resultado(s)</Text> : null;
  return (
    <View style={as.pager} accessibilityRole="toolbar">
      <Button label="Anterior" icon="chevron-back" size="sm" variant="outline" disabled={page <= 1} onPress={() => onPage(page - 1)} />
      <Text style={as.muted}>
        Página {page} de {pages} · {total} en total
      </Text>
      <Button label="Siguiente" size="sm" variant="outline" disabled={page >= pages} onPress={() => onPage(page + 1)} />
    </View>
  );
}

export const openGame = (id: string) => router.push({ pathname: '/admin/partida/[id]', params: { id } });
export const openPlayer = (id: number) => router.push({ pathname: '/admin/jugador/[id]', params: { id: String(id) } });
export const openTournament = (id: string) => router.push({ pathname: '/admin/torneo/[id]', params: { id } });

const ENTITY_LABEL: Record<string, string> = {
  mano: 'Mano',
  partida: 'Partida',
  jugador: 'Jugador',
  usuario: 'Cuenta',
  configuracion: 'Configuración',
  torneo: 'Torneo',
};

const ACTION_LABEL: Record<string, string> = {
  crear: 'creación',
  editar: 'edición',
  eliminar: 'eliminación',
  cancelar: 'cancelación',
  reabrir: 'reapertura',
  papelera: 'enviado a la papelera',
  restaurar: 'restauración',
  eliminar_definitivo: 'eliminación definitiva',
  fusionar: 'fusión de duplicados',
  marcar_prueba: 'marcada como prueba',
  marcar_oficial: 'marcada como oficial',
  pausar: 'pausa',
  reanudar: 'reanudación',
  editar_participante: 'cambio de participante',
  resortear: 'nuevo sorteo del cuadro',
};

/** Resumen legible de los valores anteriores y nuevos de un cambio. */
export function describeChange(c: Correction): string {
  const b = (c.before ?? {}) as Record<string, unknown>;
  const a = (c.after ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (key === 'dependencies' || key === 'sides' || key === 'totals') continue;
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    if (!(key in b)) parts.push(`${key}: ${show(a[key])}`);
    else if (!(key in a)) parts.push(`${key}: ${show(b[key])} (antes)`);
    else parts.push(`${key}: ${show(b[key])} → ${show(a[key])}`);
  }
  const text = parts.join(' · ');
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

export function AuditList({ corrections }: { corrections: Correction[] }) {
  if (!corrections.length) return <Text style={as.muted}>Sin cambios registrados.</Text>;
  return (
    <View>
      {corrections.map((c, i) => (
        <View key={c.id} style={[as.audit, i < corrections.length - 1 && as.rowBorder]}>
          <View style={as.auditTop}>
            <Text style={as.rowTitle}>
              {ENTITY_LABEL[c.entity] ?? c.entity} · {ACTION_LABEL[c.action] ?? c.action}
            </Text>
            <Text style={as.muted}>{formatDateTime(c.createdAt)}</Text>
          </View>
          <Text style={as.reason}>“{c.reason}”</Text>
          <Text style={as.muted}>
            Autor: <Text style={{ color: colors.text }}>{c.adminUsername}</Text> · {c.entityId}
            {c.gameId && c.action !== 'eliminar_definitivo' ? (
              <Text style={as.link} onPress={() => openGame(c.gameId!)} accessibilityRole="link">
                {'  '}Ver partida
              </Text>
            ) : null}
          </Text>
          {c.before != null || c.after != null ? <Text style={as.diff}>{describeChange(c)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export const as = StyleSheet.create({
  stack: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 32 },
  subTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: space.sm },
  muted: { color: colors.textMuted, fontSize: 13 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  kpi: { flexGrow: 1, flexBasis: 150, backgroundColor: colors.surface, borderWidth: 1.5, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  kpiIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50 },
  kpiLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, flexWrap: 'wrap' },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowActions: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  tag: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  danger: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  iconAction: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  gridItem: { flexGrow: 1, flexBasis: 320 },
  audit: { paddingVertical: space.md, gap: 4 },
  auditTop: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  reason: { color: colors.text, fontSize: 15, fontStyle: 'italic' },
  link: { color: colors.purple, fontWeight: '700', textDecorationLine: 'underline' },
  diff: { color: colors.lime, fontSize: 13, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: space.md },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
});
