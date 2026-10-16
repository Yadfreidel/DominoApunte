import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { GameStatus, Mode } from '@/domain/game.ts';
import { ROLE_LABEL, type Correction, type Paged, type PlayerRow, type Role, type ServerGame, type ServerSettings, type Summary, type User } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';
import { DateFilter, type DateRange } from '../DateFilter';
import { useDialogs } from '../Dialogs';
import { GameSummary } from '../GameSummary';
import { RankingTable } from '../RankingTable';
import { Button, Card, EmptyState, ErrorText, Field, Label, Pill, Select } from '../ui';
import { as, AuditList, errorMessage, IconAction, Kpi, openGame, openPlayer, Pager, QueryState, SearchField, SectionHeader, useDebounced } from './common';
import { FormModal } from './FormModal';
import { useAdminQuery } from './useAdminQuery';

// ---------------------------------------------------------------- Resumen
export function AdminHome() {
  const q = useAdminQuery<Summary>('/admin/summary');
  return (
    <View style={as.stack}>
      <SectionHeader
        title="Resumen"
        subtitle="Datos reales del servidor"
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {q.data && !q.loading ? (
        <>
          <View style={as.kpis}>
            <Kpi icon="people" label="Jugadores" value={q.data.players} color={colors.lime} />
            <Kpi icon="grid" label="Partidas" value={q.data.games} color={colors.purple} />
            <Kpi icon="play-circle" label="En curso" value={q.data.active} color={colors.warning} />
            <Kpi icon="trophy" label="Torneos activos" value={q.data.activeTournaments} color={colors.success} />
            <Kpi icon="flask" label="De prueba" value={q.data.practice} color={colors.info} />
            <Kpi icon="trash" label="En la papelera" value={q.data.trash} color={colors.danger} />
          </View>
          <Text style={as.subTitle}>Últimas actividades administrativas</Text>
          <Card>
            <AuditList corrections={q.data.recentActivity} />
          </Card>
          <Text style={as.subTitle}>Partidas recientes</Text>
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

// ---------------------------------------------------------------- Partidas
export function gameQuery(filters: { status?: string; type?: string; player?: string; range?: DateRange; page?: number; size?: number }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.player) params.set('player', filters.player);
  if (filters.range?.from) params.set('from', filters.range.from);
  if (filters.range?.to) params.set('to', filters.range.to);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.size) params.set('size', String(filters.size));
  return params.toString();
}

export function GameFilters({
  status,
  setStatus,
  type,
  setType,
  player,
  setPlayer,
  setRange,
}: {
  status: GameStatus | '';
  setStatus: (s: GameStatus | '') => void;
  type: '' | 'reales' | 'prueba';
  setType: (t: '' | 'reales' | 'prueba') => void;
  player: string;
  setPlayer: (p: string) => void;
  setRange: (r: DateRange) => void;
}) {
  return (
    <Card style={{ gap: space.md }}>
      <DateFilter onChange={setRange} />
      <Field label="Jugador" value={player} onChangeText={setPlayer} placeholder="Nombre o parte del nombre" />
      <View>
        <Label>Estado</Label>
        <View style={as.wrap}>
          <Pill label="Todas" active={status === ''} onPress={() => setStatus('')} />
          <Pill label="En curso" color={colors.warning} active={status === 'pendiente'} onPress={() => setStatus('pendiente')} />
          <Pill label="Terminadas" color={colors.success} active={status === 'terminada'} onPress={() => setStatus('terminada')} />
          <Pill label="Canceladas" color={colors.danger} active={status === 'cancelada'} onPress={() => setStatus('cancelada')} />
        </View>
      </View>
      <View>
        <Label>Tipo</Label>
        <View style={as.wrap}>
          <Pill label="Todas" active={type === ''} onPress={() => setType('')} />
          <Pill label="Oficiales" active={type === 'reales'} onPress={() => setType('reales')} />
          <Pill label="De prueba" color={colors.info} active={type === 'prueba'} onPress={() => setType('prueba')} />
        </View>
      </View>
    </Card>
  );
}

export function AdminGames() {
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [type, setType] = useState<'' | 'reales' | 'prueba'>('');
  const [player, setPlayer] = useState('');
  const [range, setRange] = useState<DateRange>({});
  const [page, setPage] = useState(1);
  const debounced = useDebounced(player);
  const filtersKey = `${status}|${type}|${debounced}|${range.from}|${range.to}`;
  const [lastKey, setLastKey] = useState(filtersKey);
  if (filtersKey !== lastKey) {
    // Cambiar un filtro vuelve a la primera página.
    setLastKey(filtersKey);
    setPage(1);
  }
  const q = useAdminQuery<{ games: ServerGame[] } & Paged>(`/admin/games?${gameQuery({ status, type, player: debounced, range, page, size: 20 })}`);

  return (
    <View style={as.stack}>
      <SectionHeader title="Partidas" subtitle="Filtra, abre el detalle para corregir resultados o envíala a la papelera" />
      <GameFilters status={status} setStatus={setStatus} type={type} setType={setType} player={player} setPlayer={setPlayer} setRange={setRange} />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.games.length ? (
          <>
            <View style={as.grid}>
              {q.data.games.map((g) => (
                <View key={g.id} style={as.gridItem}>
                  <GameSummary game={g} onPress={() => openGame(g.id)} />
                  {g.practice ? <Text style={[as.tag, { color: colors.info }]}>De prueba (no cuenta en estadísticas)</Text> : null}
                </View>
              ))}
            </View>
            <Pager page={q.data.page} size={q.data.size} total={q.data.total} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon="search-outline" title="Sin partidas" message="No hay partidas con esos filtros." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Pruebas
export function AdminTests() {
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ total: number; games: ServerGame[] }>('/admin/tests');
  const [busy, setBusy] = useState(false);

  const cleanup = async () => {
    if (!q.data?.total) return;
    const reason = await askReason({
      title: `¿Limpiar ${q.data.total} partida(s) de prueba?`,
      message: 'Se envían a la papelera (se pueden restaurar). Las partidas oficiales no se tocan.',
      confirmLabel: 'Limpiar pruebas',
      destructive: true,
    });
    if (!reason) return;
    setBusy(true);
    try {
      const r = await api<{ moved: number; skipped: { id: string; error: string }[] }>('/admin/tests/cleanup', {
        method: 'POST',
        body: { reason, confirm: true },
      });
      toast(`${r.moved} partida(s) de prueba en la papelera${r.skipped.length ? ` · ${r.skipped.length} bloqueada(s) por un torneo` : ''}`);
      q.reload();
      void syncNow();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Partidas de prueba"
        subtitle="No cuentan en estadísticas ni ranking. Para marcar una partida, ábrela y usa «Marcar como prueba»."
        right={<Button label="Limpiar pruebas" icon="trash-outline" size="sm" variant="danger" onPress={cleanup} loading={busy} disabled={!q.data?.total} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.games.length ? (
          <>
            <Text style={as.muted}>{q.data.total} partida(s) de prueba{q.data.total > q.data.games.length ? ` (se muestran ${q.data.games.length})` : ''}.</Text>
            <View style={as.grid}>
              {q.data.games.map((g) => (
                <View key={g.id} style={as.gridItem}>
                  <GameSummary game={g} onPress={() => openGame(g.id)} />
                </View>
              ))}
            </View>
          </>
        ) : (
          <EmptyState icon="flask-outline" title="Sin partidas de prueba" message="Las partidas de práctica o marcadas como prueba aparecen aquí." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Ranking
export function AdminRanking() {
  const q = useAdminQuery<{ ranking: (PlayerRow & { position: number })[] }>('/admin/ranking');
  return (
    <View style={as.stack}>
      <SectionHeader
        title="Ranking"
        subtitle="Solo partidas oficiales (sin pruebas ni papelera)"
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.ranking.length ? (
          <Card>
            <RankingTable rows={q.data.ranking.map((r) => ({ ...r, key: String(r.id) }))} onPressRow={(key) => openPlayer(Number(key))} />
          </Card>
        ) : (
          <EmptyState icon="podium-outline" title="Sin ranking todavía" message="El ranking aparece cuando hay partidas sincronizadas." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Auditoría
const AUDIT_ENTITIES = [
  { value: '', label: 'Todo' },
  { value: 'partida', label: 'Partidas' },
  { value: 'mano', label: 'Manos' },
  { value: 'jugador', label: 'Jugadores' },
  { value: 'torneo', label: 'Torneos' },
  { value: 'usuario', label: 'Cuentas' },
  { value: 'configuracion', label: 'Configuración' },
];

export function AdminAudit() {
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>({});
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const key = `${entity}|${debounced}|${range.from}|${range.to}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }
  const params = new URLSearchParams({ page: String(page), size: '25' });
  if (entity) params.set('entity', entity);
  if (debounced) params.set('search', debounced);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const q = useAdminQuery<{ corrections: Correction[] } & Paged>(`/admin/audit?${params.toString()}`);
  return (
    <View style={as.stack}>
      <SectionHeader
        title="Auditoría"
        subtitle="Autor, fecha, acción, motivo y valores anteriores y nuevos. Solo lectura: no se puede editar ni borrar."
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <Card style={{ gap: space.md }}>
        <View style={as.wrap}>
          {AUDIT_ENTITIES.map((e) => (
            <Pill key={e.value} label={e.label} active={entity === e.value} onPress={() => setEntity(e.value)} />
          ))}
        </View>
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por motivo, autor o identificador…" />
        <DateFilter onChange={setRange} />
      </Card>
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.corrections.length ? (
          <>
            <Card>
              <AuditList corrections={q.data.corrections} />
            </Card>
            <Pager page={q.data.page} size={q.data.size} total={q.data.total} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon="document-text-outline" title="Sin registros" message="No hay cambios administrativos con esos filtros." />
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Reglas
export function AdminRules() {
  const q = useAdminQuery<{ settings: ServerSettings }>('/admin/settings');
  return (
    <View style={as.stack}>
      <SectionHeader
        title="Reglas"
        subtitle="Valores predeterminados para partidas nuevas. Cada usuario puede cambiarlos al crear su partida; las partidas existentes no cambian."
      />
      <QueryState {...q} />
      {!q.loading && q.data ? <RulesForm initial={q.data.settings} onSaved={q.reload} /> : null}
    </View>
  );
}

function RulesForm({ initial, onSaved }: { initial: ServerSettings; onSaved: () => void }) {
  const { api, refreshPublicConfig } = useStore();
  const { askReason, toast } = useDialogs();
  const [targets, setTargets] = useState<number[]>(initial.defaultTargets);
  const [defaultTarget, setDefaultTarget] = useState(initial.defaultTarget);
  const [defaultMode, setDefaultMode] = useState<Mode>(initial.defaultMode ?? 'individual');
  const [passText, setPassText] = useState(String(initial.rules?.passPoints ?? 0));
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
    const passPoints = Number(passText || '0');
    if (!Number.isInteger(passPoints) || passPoints < 0 || passPoints > 1000) return setError('Los puntos por pase deben estar entre 0 y 1000.');
    const reason = await askReason({ title: '¿Guardar las reglas predeterminadas?', message: 'Solo afectan a partidas nuevas.', confirmLabel: 'Guardar' });
    if (!reason) return;
    setSaving(true);
    setError(null);
    try {
      await api('/admin/settings', { method: 'PUT', body: { defaultTargets: targets, defaultTarget, defaultMode, rules: { passPoints }, reason } });
      toast('Reglas guardadas. Los dispositivos las reciben al abrir la app.');
      void refreshPublicConfig();
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: space.lg }}>
      <View>
        <Label>Metas sugeridas (toca para quitar)</Label>
        <View style={as.wrap}>
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
        <View style={[as.wrap, { marginTop: space.sm }]}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field value={newTarget} onChangeText={(t) => setNewTarget(t.replace(/[^\d]/g, ''))} placeholder="Nueva meta" keyboardType="number-pad" maxLength={5} accessibilityLabel="Nueva meta" />
          </View>
          <Button label="Agregar" icon="add" variant="outline" onPress={add} />
        </View>
      </View>
      <Select label="Meta predeterminada" value={defaultTarget} onChange={setDefaultTarget} options={targets.map((t) => ({ value: t, label: `${t} puntos` }))} />
      <Select
        label="Modalidad predeterminada"
        value={defaultMode}
        onChange={setDefaultMode}
        options={[
          { value: 'individual', label: 'Individual' },
          { value: 'parejas', label: 'Por parejas' },
        ]}
      />
      <Field
        label="Penalización opcional: puntos por pase (0 = desactivada)"
        value={passText}
        onChangeText={(t) => setPassText(t.replace(/[^\d]/g, ''))}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Text style={as.muted}>Con un valor mayor que 0, el teclado de la partida muestra el botón «Pase» para anotar esos puntos al rival.</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Guardar reglas" icon="save-outline" onPress={save} loading={saving} />
    </Card>
  );
}

// ---------------------------------------------------------------- Cuentas de acceso
export function AdminUsers() {
  const { api, user: me } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ users: User[] }>('/admin/users');
  const players = useAdminQuery<{ players: PlayerRow[] }>('/admin/players?size=100');
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Role>('anotador');
  const [editing, setEditing] = useState<User | null>(null);
  const [linkTo, setLinkTo] = useState<number>(0);
  const isOwner = me?.role === 'propietario';

  // El propietario gestiona administradores; los administradores, solo anotadores. El servidor lo verifica.
  const canManage = (u: User) => u.id === me?.id || (u.role === 'anotador') || (u.role === 'admin' && isOwner);

  const patch = async (u: User, body: Record<string, unknown>, title: string, destructive = false) => {
    const reason = await askReason({ title, confirmLabel: 'Confirmar', destructive });
    if (!reason) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { ...body, reason } });
      toast('Cuenta actualizada');
      q.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const playerOptions = [{ value: 0, label: 'Sin perfil de jugador' }, ...(players.data?.players ?? []).map((p) => ({ value: p.id, label: p.name }))];

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Cuentas"
        subtitle="Cuentas de acceso. Un perfil de jugador no necesita cuenta; una cuenta puede vincularse a un perfil."
        right={<Button label="Nueva cuenta" icon="person-add" size="sm" onPress={() => setCreating(true)} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        <Card style={{ padding: space.sm }}>
          {q.data.users.map((u, i) => {
            const self = u.id === me?.id;
            const manageable = canManage(u);
            const linked = players.data?.players.find((p) => p.id === u.playerId);
            return (
              <View key={u.id} style={[as.listRow, i < q.data!.users.length - 1 && as.rowBorder]}>
                <Ionicons name={u.role === 'anotador' ? 'person' : 'shield-checkmark'} size={22} color={u.role === 'anotador' ? colors.lime : colors.purple} />
                <View style={{ flex: 1, minWidth: 160 }}>
                  <Text style={[as.rowTitle, !u.active && { color: colors.textDim }]}>
                    {u.username} {self ? <Text style={as.muted}>(tú)</Text> : null}
                    {!u.active ? <Text style={as.danger}> · bloqueada</Text> : null}
                  </Text>
                  <Text style={as.muted}>
                    {ROLE_LABEL[u.role]}
                    {u.email ? ` · ${u.email}` : ''}
                    {linked ? ` · perfil: ${linked.name}` : ''}
                  </Text>
                </View>
                {manageable ? (
                  <View style={as.rowActions}>
                    <IconAction
                      icon="create-outline"
                      label={`Editar ${u.username}`}
                      onPress={() => {
                        setLinkTo(u.playerId ?? 0);
                        setEditing(u);
                      }}
                    />
                    {!self && u.role !== 'propietario' && isOwner ? (
                      <IconAction
                        icon="swap-horizontal"
                        label="Cambiar rol"
                        onPress={() => patch(u, { role: u.role === 'admin' ? 'anotador' : 'admin' }, `¿Cambiar a ${u.username} a ${u.role === 'admin' ? 'anotador' : 'administrador'}?`)}
                      />
                    ) : null}
                    {!self && u.role !== 'propietario' ? (
                      <IconAction
                        icon={u.active ? 'lock-closed-outline' : 'lock-open-outline'}
                        label={u.active ? `Bloquear a ${u.username}` : `Desbloquear a ${u.username}`}
                        color={u.active ? colors.danger : colors.lime}
                        onPress={() => patch(u, { active: !u.active }, u.active ? `¿Bloquear a ${u.username}? Sus sesiones se cerrarán.` : `¿Desbloquear a ${u.username}?`, u.active)}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Text style={as.muted}>Solo el propietario</Text>
                )}
              </View>
            );
          })}
        </Card>
      ) : null}

      <FormModal
        visible={creating}
        title="Nueva cuenta"
        description="No hay registro público: las cuentas se crean aquí. El rol de propietario solo se asigna desde el servidor."
        fields={[
          { key: 'username', label: 'Usuario' },
          { key: 'email', label: 'Correo (para iniciar sesión y recuperar la contraseña)', placeholder: 'opcional' },
          { key: 'password', label: 'Contraseña (mínimo 10 caracteres)', secure: true },
        ]}
        submitLabel="Crear cuenta"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          await api('/admin/users', { method: 'POST', body: { username: v.username, email: v.email || undefined, password: v.password, role } });
          setCreating(false);
          toast('Cuenta creada');
          q.reload();
        }}
      >
        <Select
          label="Rol"
          value={role}
          onChange={setRole}
          options={[
            { value: 'anotador', label: 'Anotador (registra y sincroniza sus partidas)' },
            { value: 'admin', label: 'Administrador', disabled: !isOwner, hint: isOwner ? undefined : 'Solo el propietario' },
          ]}
        />
      </FormModal>
      <FormModal
        visible={!!editing}
        title={`Cuenta de ${editing?.username ?? ''}`}
        description="Deja la contraseña vacía para no cambiarla. Cambiarla cierra sus sesiones abiertas."
        fields={[
          { key: 'email', label: 'Correo', initial: editing?.email ?? '' },
          { key: 'password', label: 'Nueva contraseña (opcional)', secure: true },
          { key: 'reason', label: 'Motivo', multiline: true },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const body: Record<string, unknown> = { reason: v.reason, email: v.email.trim() || null, playerId: linkTo || null };
          if (v.password) body.password = v.password;
          await api(`/admin/users/${editing!.id}`, { method: 'PATCH', body });
          setEditing(null);
          toast('Cuenta actualizada');
          q.reload();
        }}
      >
        <Select label="Perfil de jugador vinculado" value={linkTo} onChange={setLinkTo} options={playerOptions} />
      </FormModal>
    </View>
  );
}

export function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={as.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={as.rowTitle}>{label}</Text>
        {hint ? <Text style={as.muted}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.limeDeep }}
        thumbColor={value ? colors.lime : colors.thumbOff}
        accessibilityLabel={label}
      />
    </View>
  );
}
