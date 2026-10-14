import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { GameStatus } from '@/domain/game.ts';
import type { Correction, PlayerRow, Role, ServerGame, ServerSettings, Summary, User } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { DateFilter, type DateRange } from '../DateFilter';
import { useDialogs } from '../Dialogs';
import { formatDateTime, GameSummary } from '../GameSummary';
import { RankingTable } from '../RankingTable';
import { Button, Card, EmptyState, ErrorText, Field, Label, Loading, Pill, Select, type IconName } from '../ui';
import { FormModal } from './FormModal';
import { useAdminQuery } from './useAdminQuery';

function QueryState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
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
    <View style={s.sectionHeader}>
      <View style={{ flex: 1, minWidth: 200 }}>
        <Text style={s.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function Kpi({ icon, label, value, color }: { icon: IconName; label: string; value: number; color: string }) {
  return (
    <View style={[s.kpi, { borderColor: `${color}55` }]}>
      <View style={[s.kpiIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

const openGame = (id: string) => router.push({ pathname: '/admin/partida/[id]', params: { id } });
const openPlayer = (id: number) => router.push({ pathname: '/admin/jugador/[id]', params: { id: String(id) } });

// ---------------------------------------------------------------- Inicio
export function AdminHome() {
  const q = useAdminQuery<Summary>('/admin/summary');
  return (
    <View style={s.stack}>
      <SectionHeader
        title="Inicio"
        subtitle="Resumen general"
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {q.data && !q.loading ? (
        <>
          <View style={s.kpis}>
            <Kpi icon="people" label="Jugadores" value={q.data.players} color={colors.lime} />
            <Kpi icon="grid" label="Partidas" value={q.data.games} color={colors.purple} />
            <Kpi icon="play-circle" label="Activas" value={q.data.active} color={colors.warning} />
            <Kpi icon="trophy" label="Terminadas" value={q.data.finished} color={colors.success} />
            <Kpi icon="close-circle" label="Canceladas" value={q.data.cancelled} color={colors.danger} />
            <Kpi icon="create" label="Correcciones" value={q.data.corrections} color="#35D6F5" />
          </View>
          <Text style={s.subTitle}>Actividad reciente</Text>
          {q.data.recentGames.length ? (
            q.data.recentGames.map((g) => <GameSummary key={g.id} game={g} onPress={() => openGame(g.id)} />)
          ) : (
            <EmptyState
              icon="cloud-upload-outline"
              title="Aún no hay partidas"
              message="Las partidas aparecen aquí cuando un dispositivo con sesión iniciada las sincroniza."
            />
          )}
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Jugadores
export function AdminPlayers() {
  const { api } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ players: PlayerRow[] }>('/admin/players');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlayerRow | null>(null);
  const [search, setSearch] = useState('');

  const toggleActive = async (p: PlayerRow) => {
    const reason = await askReason({
      title: p.active ? `¿Desactivar a ${p.name}?` : `¿Reactivar a ${p.name}?`,
      message: p.active ? 'Se conserva su historial y estadísticas.' : undefined,
      confirmLabel: p.active ? 'Desactivar' : 'Reactivar',
      destructive: p.active,
    });
    if (!reason) return;
    try {
      await api(`/admin/players/${p.id}`, { method: 'PATCH', body: { active: !p.active, reason } });
      toast(p.active ? 'Jugador desactivado' : 'Jugador reactivado');
      q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const remove = async (p: PlayerRow) => {
    const reason = await askReason({
      title: `¿Eliminar a ${p.name}?`,
      message: 'Esta acción no se puede deshacer. Solo se pueden eliminar jugadores sin partidas.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!reason) return;
    try {
      await api(`/admin/players/${p.id}`, { method: 'DELETE', body: { reason } });
      toast('Jugador eliminado');
      q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const players = (q.data?.players ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <View style={s.stack}>
      <SectionHeader
        title="Jugadores"
        subtitle="Alta, edición y estadísticas"
        right={<Button label="Nuevo jugador" icon="person-add" size="sm" onPress={() => setCreating(true)} />}
      />
      <Field value={search} onChangeText={setSearch} placeholder="Buscar jugador…" />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        players.length ? (
          <Card style={{ padding: space.sm }}>
            {players.map((p, i) => (
              <View key={p.id} style={[s.listRow, i < players.length - 1 && s.rowBorder]}>
                <Pressable style={{ flex: 1, minWidth: 160 }} onPress={() => openPlayer(p.id)} accessibilityRole="button">
                  <Text style={[s.rowTitle, !p.active && { color: colors.textDim }]}>
                    {p.name} {!p.active ? <Text style={s.inactive}>(inactivo)</Text> : null}
                  </Text>
                  <Text style={s.muted}>
                    {p.played} jugadas · {p.wins} G · {p.losses} P · {p.winRate}% · {p.pending} pendientes
                  </Text>
                </Pressable>
                <View style={s.rowActions}>
                  <IconAction icon="create-outline" label={`Editar ${p.name}`} onPress={() => setEditing(p)} />
                  <IconAction
                    icon={p.active ? 'pause-circle-outline' : 'play-circle-outline'}
                    label={p.active ? 'Desactivar' : 'Reactivar'}
                    onPress={() => toggleActive(p)}
                  />
                  <IconAction icon="trash-outline" label={`Eliminar ${p.name}`} color={colors.danger} onPress={() => remove(p)} />
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState icon="people-outline" title="Sin jugadores" message="Agrega jugadores o sincroniza partidas desde un dispositivo." />
        )
      ) : null}

      <FormModal
        visible={creating}
        title="Nuevo jugador"
        fields={[{ key: 'name', label: 'Nombre', placeholder: 'Nombre del jugador' }]}
        submitLabel="Crear"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          await api('/admin/players', { method: 'POST', body: { name: v.name } });
          setCreating(false);
          toast('Jugador creado');
          q.reload();
        }}
      />
      <FormModal
        visible={!!editing}
        title={`Editar a ${editing?.name ?? ''}`}
        description="El cambio de nombre se aplica también a sus partidas y queda registrado."
        fields={[
          { key: 'name', label: 'Nombre', initial: editing?.name },
          { key: 'reason', label: 'Motivo de la corrección', multiline: true, placeholder: 'Ej.: nombre mal escrito' },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          await api(`/admin/players/${editing!.id}`, { method: 'PATCH', body: { name: v.name, reason: v.reason } });
          setEditing(null);
          toast('Jugador actualizado');
          q.reload();
        }}
      />
    </View>
  );
}

function IconAction({ icon, label, onPress, color = colors.textMuted }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [s.iconAction, pressed && { backgroundColor: 'rgba(255,255,255,0.06)' }]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- Partidas
export function AdminGames() {
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [player, setPlayer] = useState('');
  const [range, setRange] = useState<DateRange>({});
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(player.trim()), 350);
    return () => clearTimeout(t);
  }, [player]);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (debounced) params.set('player', debounced);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const q = useAdminQuery<{ games: ServerGame[] }>(`/admin/games?${params.toString()}`);

  return (
    <View style={s.stack}>
      <SectionHeader title="Partidas" subtitle="Consulta, correcciones e historial de manos" />
      <Card style={{ gap: space.md }}>
        <DateFilter onChange={setRange} />
        <Field label="Jugador" value={player} onChangeText={setPlayer} placeholder="Nombre o parte del nombre" />
        <View>
          <Label>Estado</Label>
          <View style={s.wrap}>
            <Pill label="Todas" active={status === ''} onPress={() => setStatus('')} />
            <Pill label="Pendientes" color={colors.warning} active={status === 'pendiente'} onPress={() => setStatus('pendiente')} />
            <Pill label="Terminadas" color={colors.success} active={status === 'terminada'} onPress={() => setStatus('terminada')} />
            <Pill label="Canceladas" color={colors.danger} active={status === 'cancelada'} onPress={() => setStatus('cancelada')} />
          </View>
        </View>
      </Card>
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.games.length ? (
          <View style={s.grid}>
            {q.data.games.map((g) => (
              <View key={g.id} style={s.gridItem}>
                <GameSummary game={g} onPress={() => openGame(g.id)} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="search-outline" title="Sin partidas" message="No hay partidas con esos filtros." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Ranking
export function AdminRanking() {
  const q = useAdminQuery<{ ranking: (PlayerRow & { position: number })[] }>('/admin/ranking');
  return (
    <View style={s.stack}>
      <SectionHeader
        title="Ranking"
        subtitle="Ordenado por partidas ganadas"
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.ranking.length ? (
          <Card>
            <RankingTable
              rows={q.data.ranking.map((r) => ({ ...r, key: String(r.id) }))}
              onPressRow={(key) => openPlayer(Number(key))}
            />
          </Card>
        ) : (
          <EmptyState icon="podium-outline" title="Sin ranking todavía" message="El ranking aparece cuando hay partidas sincronizadas." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Correcciones
const ENTITY_LABEL: Record<string, string> = {
  mano: 'Mano',
  partida: 'Partida',
  jugador: 'Jugador',
  usuario: 'Usuario',
  configuracion: 'Configuración',
};

export function CorrectionList({ corrections }: { corrections: Correction[] }) {
  if (!corrections.length) return <Text style={s.muted}>Sin correcciones registradas.</Text>;
  return (
    <View>
      {corrections.map((c, i) => (
        <View key={c.id} style={[s.correction, i < corrections.length - 1 && s.rowBorder]}>
          <View style={s.correctionTop}>
            <Text style={s.rowTitle}>
              {ENTITY_LABEL[c.entity] ?? c.entity} · {c.action}
            </Text>
            <Text style={s.muted}>{formatDateTime(c.createdAt)}</Text>
          </View>
          <Text style={s.reason}>“{c.reason}”</Text>
          <Text style={s.muted}>
            Responsable: <Text style={{ color: colors.text }}>{c.adminUsername}</Text>
            {c.gameId ? (
              <Text style={s.link} onPress={() => openGame(c.gameId!)}>
                {'  '}Ver partida
              </Text>
            ) : null}
          </Text>
          {c.before != null || c.after != null ? <Text style={s.diff}>{describeChange(c)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function describeChange(c: Correction): string {
  const b = c.before as Record<string, unknown> | null;
  const a = c.after as Record<string, unknown> | null;
  if (c.entity === 'mano' && b && 'points' in b && a && 'points' in a) return `Puntos: ${b.points} → ${a.points}`;
  if (b && a && 'status' in b && 'status' in a) return `Estado: ${b.status} → ${a.status}`;
  if (b && a && 'name' in b && 'name' in a && b.name !== a.name) return `Nombre: ${b.name} → ${a.name}`;
  if (b && a && 'active' in b && 'active' in a && b.active !== a.active) return a.active ? 'Reactivado' : 'Desactivado';
  return '';
}

export function AdminCorrections() {
  const q = useAdminQuery<{ corrections: Correction[] }>('/admin/corrections');
  return (
    <View style={s.stack}>
      <SectionHeader
        title="Correcciones"
        subtitle="Registro de cambios administrativos con fecha, motivo y responsable"
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        <Card>
          <CorrectionList corrections={q.data.corrections} />
        </Card>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Configuración
export function AdminSettings() {
  const q = useAdminQuery<{ settings: ServerSettings }>('/admin/settings');
  return (
    <View style={s.stack}>
      <SectionHeader title="Configuración" subtitle="Metas predeterminadas y modalidades para todos los dispositivos" />
      <QueryState {...q} />
      {!q.loading && q.data ? <SettingsForm initial={q.data.settings} /> : null}
    </View>
  );
}

function SettingsForm({ initial }: { initial: ServerSettings }) {
  const { api, syncNow } = useStore();
  const { toast } = useDialogs();
  const [targets, setTargets] = useState<number[]>(initial.defaultTargets);
  const [defaultTarget, setDefaultTarget] = useState(initial.defaultTarget);
  const [modes, setModes] = useState(initial.modes);
  const [newTarget, setNewTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = () => {
    const n = Number(newTarget);
    if (!/^\d+$/.test(newTarget) || n < 1 || n > 10000) return setError('Escribe una meta entre 1 y 10000.');
    if (targets.includes(n)) return setError('Esa meta ya existe.');
    if (targets.length >= 8) return setError('Máximo 8 metas.');
    setTargets([...targets, n].sort((a, b) => a - b));
    setNewTarget('');
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/admin/settings', { method: 'PUT', body: { defaultTargets: targets, defaultTarget, modes } });
      toast('Configuración guardada. Los dispositivos la recibirán al sincronizar.');
      void syncNow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
        <Card style={{ gap: space.lg }}>
          <View>
            <Label>Metas disponibles (toca para quitar)</Label>
            <View style={s.wrap}>
              {targets.map((t) => (
                <Pill
                  key={t}
                  label={`${t}  ✕`}
                  active={t === defaultTarget}
                  onPress={() => {
                    if (targets.length <= 1) return setError('Debe quedar al menos una meta.');
                    const next = targets.filter((x) => x !== t);
                    setTargets(next);
                    if (defaultTarget === t) setDefaultTarget(next[0]);
                  }}
                />
              ))}
            </View>
            <View style={[s.wrap, { marginTop: space.sm }]}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field value={newTarget} onChangeText={(t) => setNewTarget(t.replace(/[^\d]/g, ''))} placeholder="Nueva meta" keyboardType="number-pad" maxLength={5} />
              </View>
              <Button label="Agregar" icon="add" variant="outline" onPress={add} />
            </View>
          </View>
          <Select
            label="Meta predeterminada"
            value={defaultTarget}
            onChange={setDefaultTarget}
            options={targets.map((t) => ({ value: t, label: `${t} puntos` }))}
          />
          <View style={{ gap: space.sm }}>
            <Label>Modalidades</Label>
            {(['individual', 'parejas'] as const).map((m) => (
              <View key={m} style={s.toggle}>
                <Text style={s.rowTitle}>{m === 'individual' ? 'Individual' : 'Por parejas'}</Text>
                <Switch
                  value={modes[m]}
                  onValueChange={(v) => setModes((cur) => ({ ...cur, [m]: v }))}
                  trackColor={{ false: colors.border, true: colors.limeDeep }}
                  thumbColor={modes[m] ? colors.lime : '#C9CEE6'}
                  accessibilityLabel={m}
                />
              </View>
            ))}
          </View>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label="Guardar configuración" icon="save-outline" onPress={save} loading={saving} />
        </Card>
  );
}

// ---------------------------------------------------------------- Usuarios
export function AdminUsers() {
  const { api, user: me } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ users: User[] }>('/admin/users');
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Role>('anotador');
  const [resetting, setResetting] = useState<User | null>(null);

  const patch = async (u: User, body: Record<string, unknown>, title: string, destructive = false) => {
    const reason = await askReason({ title, confirmLabel: 'Confirmar', destructive });
    if (!reason) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { ...body, reason } });
      toast('Usuario actualizado');
      q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  return (
    <View style={s.stack}>
      <SectionHeader
        title="Usuarios"
        subtitle="Cuentas con acceso: administradores y anotadores"
        right={<Button label="Nuevo usuario" icon="person-add" size="sm" onPress={() => setCreating(true)} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        <Card style={{ padding: space.sm }}>
          {q.data.users.map((u, i) => {
            const self = u.id === me?.id;
            return (
              <View key={u.id} style={[s.listRow, i < q.data!.users.length - 1 && s.rowBorder]}>
                <Ionicons name={u.role === 'admin' ? 'shield-checkmark' : 'person'} size={22} color={u.role === 'admin' ? colors.purple : colors.lime} />
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={[s.rowTitle, !u.active && { color: colors.textDim }]}>
                    {u.username} {self ? <Text style={s.muted}>(tú)</Text> : null}
                    {!u.active ? <Text style={s.inactive}> (inactivo)</Text> : null}
                  </Text>
                  <Text style={s.muted}>{u.role === 'admin' ? 'Administrador' : 'Anotador'}</Text>
                </View>
                <View style={s.rowActions}>
                  {!self ? (
                    <IconAction
                      icon="swap-horizontal"
                      label="Cambiar rol"
                      onPress={() =>
                        patch(u, { role: u.role === 'admin' ? 'anotador' : 'admin' }, `¿Cambiar ${u.username} a ${u.role === 'admin' ? 'anotador' : 'administrador'}?`)
                      }
                    />
                  ) : null}
                  <IconAction icon="key-outline" label="Cambiar contraseña" onPress={() => setResetting(u)} />
                  {!self ? (
                    <IconAction
                      icon={u.active ? 'pause-circle-outline' : 'play-circle-outline'}
                      label={u.active ? 'Desactivar' : 'Reactivar'}
                      color={u.active ? colors.danger : colors.lime}
                      onPress={() => patch(u, { active: !u.active }, u.active ? `¿Desactivar a ${u.username}? Sus sesiones se cerrarán.` : `¿Reactivar a ${u.username}?`, u.active)}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <FormModal
        visible={creating}
        title="Nuevo usuario"
        description="Los anotadores pueden sincronizar partidas. Los administradores además acceden a este panel."
        fields={[
          { key: 'username', label: 'Usuario' },
          { key: 'password', label: 'Contraseña (mínimo 10 caracteres)', secure: true },
        ]}
        submitLabel="Crear usuario"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          await api('/admin/users', { method: 'POST', body: { username: v.username, password: v.password, role } });
          setCreating(false);
          toast('Usuario creado');
          q.reload();
        }}
      >
        <Select
          label="Rol"
          value={role}
          onChange={setRole}
          options={[
            { value: 'anotador', label: 'Anotador' },
            { value: 'admin', label: 'Administrador' },
          ]}
        />
      </FormModal>
      <FormModal
        visible={!!resetting}
        title={`Contraseña de ${resetting?.username ?? ''}`}
        description="Se cerrarán todas sus sesiones abiertas."
        fields={[
          { key: 'password', label: 'Nueva contraseña (mínimo 10 caracteres)', secure: true },
          { key: 'reason', label: 'Motivo', multiline: true },
        ]}
        onClose={() => setResetting(null)}
        onSubmit={async (v) => {
          await api(`/admin/users/${resetting!.id}`, { method: 'PATCH', body: { password: v.password, reason: v.reason } });
          setResetting(null);
          toast('Contraseña actualizada');
          q.reload();
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 32 },
  subTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: space.sm },
  muted: { color: colors.textMuted, fontSize: 13 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  kpi: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
  },
  kpiIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50 },
  kpiLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, flexWrap: 'wrap' },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowActions: { flexDirection: 'row', gap: 4 },
  inactive: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  iconAction: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  gridItem: { flexGrow: 1, flexBasis: 320 },
  correction: { paddingVertical: space.md, gap: 4 },
  correctionTop: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  reason: { color: colors.text, fontSize: 15, fontStyle: 'italic' },
  link: { color: colors.purple, fontWeight: '700' },
  diff: { color: colors.lime, fontSize: 13, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
