import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { cameraAvailable, pickPhoto, type PhotoSource } from '@/services/photos';
import type { Paged, PlayerRow } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';
import { Avatar } from '../Avatar';
import { useDialogs } from '../Dialogs';
import { Button, Card, EmptyState, ErrorText, Label, Pill, Select } from '../ui';
import { as, errorMessage, IconAction, openGame, openPlayer, Pager, QueryState, SearchField, SectionHeader, useDebounced } from './common';
import { FormModal } from './FormModal';
import { useAdminQuery } from './useAdminQuery';

// ---------------------------------------------------------------- Jugadores
export function AdminPlayers() {
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'activos' | 'inactivos'>('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const key = `${debounced}|${status}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }
  const params = new URLSearchParams({ page: String(page), size: '25' });
  if (debounced) params.set('search', debounced);
  if (status) params.set('status', status);
  const q = useAdminQuery<{ players: PlayerRow[] } & Paged>(`/admin/players?${params.toString()}`);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlayerRow | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      q.reload();
      void syncNow();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const toggleActive = async (p: PlayerRow) => {
    const reason = await askReason({
      title: p.active ? `¿Desactivar el perfil de ${p.name}?` : `¿Reactivar el perfil de ${p.name}?`,
      message: p.active ? 'Se conserva su historial y sus estadísticas.' : undefined,
      confirmLabel: p.active ? 'Desactivar' : 'Reactivar',
      destructive: p.active,
    });
    if (reason) await run(() => api(`/admin/players/${p.id}`, { method: 'PATCH', body: { active: !p.active, reason } }), p.active ? 'Perfil desactivado' : 'Perfil reactivado');
  };

  const toggleAccount = async (p: PlayerRow) => {
    if (!p.account) return;
    const blocking = p.account.active;
    const reason = await askReason({
      title: blocking ? `¿Bloquear la cuenta ${p.account.username}?` : `¿Desbloquear la cuenta ${p.account.username}?`,
      message: blocking ? 'No podrá iniciar sesión y sus sesiones abiertas se cerrarán. El perfil de jugador no cambia.' : undefined,
      confirmLabel: blocking ? 'Bloquear cuenta' : 'Desbloquear',
      destructive: blocking,
    });
    if (reason) await run(() => api(`/admin/users/${p.account!.id}`, { method: 'PATCH', body: { active: !blocking, reason } }), blocking ? 'Cuenta bloqueada' : 'Cuenta desbloqueada');
  };

  const trash = async (p: PlayerRow) => {
    const reason = await askReason({
      title: `¿Enviar a ${p.name} a la papelera?`,
      message: `Su historial se conserva (${p.played} partida(s)). Puedes restaurarlo desde la Papelera.`,
      confirmLabel: 'Enviar a la papelera',
      destructive: true,
    });
    if (reason) await run(() => api(`/admin/players/${p.id}`, { method: 'DELETE', body: { reason } }), 'Perfil en la papelera');
  };

  const choosePhoto = async (source: PhotoSource) => {
    setPhotoBusy(true);
    try {
      const uri = await pickPhoto(source);
      if (uri) setPhoto(uri);
    } catch (err) {
      toast(errorMessage(err, 'No se pudo cargar la foto.'), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Jugadores"
        subtitle="Perfiles de jugadores. No todos tienen cuenta de acceso."
        right={<Button label="Nuevo perfil" icon="person-add" size="sm" onPress={() => setCreating(true)} />}
      />
      <SearchField value={search} onChange={setSearch} placeholder="Buscar jugador…" />
      <View style={as.wrap}>
        <Pill label="Todos" active={status === ''} onPress={() => setStatus('')} />
        <Pill label="Activos" active={status === 'activos'} onPress={() => setStatus('activos')} />
        <Pill label="Inactivos" active={status === 'inactivos'} onPress={() => setStatus('inactivos')} />
      </View>
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.players.length ? (
          <>
            <Card style={{ padding: space.sm }}>
              {q.data.players.map((p, i) => (
                <View key={p.id} style={[as.listRow, i < q.data!.players.length - 1 && as.rowBorder]}>
                  <Avatar name={p.name} colorIndex={0} size={44} photo={p.photo ?? undefined} />
                  <Pressable style={{ flex: 1, minWidth: 160 }} onPress={() => openPlayer(p.id)} accessibilityRole="button" accessibilityLabel={`Ver a ${p.name}`}>
                    <Text style={[as.rowTitle, !p.active && { color: colors.textDim }]}>
                      {p.name} {!p.active ? <Text style={as.danger}>(inactivo)</Text> : null}
                    </Text>
                    <Text style={as.muted}>
                      {p.played} partidas · {p.wins} G · {p.losses} P · {p.winRate}%
                      {p.account ? ` · cuenta: ${p.account.username}${p.account.active ? '' : ' (bloqueada)'}` : ' · sin cuenta'}
                    </Text>
                  </Pressable>
                  <View style={as.rowActions}>
                    <IconAction
                      icon="create-outline"
                      label={`Editar ${p.name}`}
                      onPress={() => {
                        setPhoto(p.photo);
                        setEditing(p);
                      }}
                    />
                    <IconAction icon={p.active ? 'pause-circle-outline' : 'play-circle-outline'} label={p.active ? `Desactivar a ${p.name}` : `Reactivar a ${p.name}`} onPress={() => toggleActive(p)} />
                    {p.account ? (
                      <IconAction
                        icon={p.account.active ? 'lock-closed-outline' : 'lock-open-outline'}
                        label={p.account.active ? `Bloquear la cuenta de ${p.name}` : `Desbloquear la cuenta de ${p.name}`}
                        color={p.account.active ? colors.warning : colors.lime}
                        onPress={() => toggleAccount(p)}
                      />
                    ) : null}
                    <IconAction icon="trash-outline" label={`Enviar a ${p.name} a la papelera`} color={colors.danger} onPress={() => trash(p)} />
                  </View>
                </View>
              ))}
            </Card>
            <Pager page={q.data.page} size={q.data.size} total={q.data.total} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon="people-outline" title="Sin jugadores" message={debounced ? 'Ningún jugador coincide con la búsqueda.' : 'Agrega perfiles o sincroniza partidas desde un dispositivo.'} />
        )
      ) : null}

      <FormModal
        visible={creating}
        title="Nuevo perfil de jugador"
        fields={[{ key: 'name', label: 'Nombre', placeholder: 'Nombre del jugador' }]}
        submitLabel="Crear"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          await api('/admin/players', { method: 'POST', body: { name: v.name } });
          setCreating(false);
          toast('Perfil creado');
          q.reload();
        }}
      />
      <FormModal
        visible={!!editing}
        title={`Editar a ${editing?.name ?? ''}`}
        description="El cambio de nombre se aplica a sus partidas y torneos, y queda registrado en la auditoría."
        fields={[
          { key: 'name', label: 'Nombre', initial: editing?.name },
          { key: 'reason', label: 'Motivo del cambio', multiline: true, placeholder: 'Ej.: nombre mal escrito' },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const body: Record<string, unknown> = { reason: v.reason };
          if (v.name.trim() !== editing!.name) body.name = v.name;
          if (photo !== editing!.photo) body.photo = photo;
          if (Object.keys(body).length === 1) throw new Error('No hay cambios.');
          await api(`/admin/players/${editing!.id}`, { method: 'PATCH', body });
          setEditing(null);
          toast('Perfil actualizado');
          q.reload();
          void syncNow();
        }}
      >
        <Label>Foto</Label>
        <View style={[as.wrap, { alignItems: 'center' }]}>
          {photo ? <Image source={{ uri: photo }} style={as.avatar} accessibilityLabel="Foto actual" /> : <Ionicons name="person-circle-outline" size={44} color={colors.textDim} />}
          {cameraAvailable ? <Button label="Cámara" icon="camera-outline" size="sm" variant="outline" onPress={() => choosePhoto('camera')} loading={photoBusy} /> : null}
          <Button label="Galería" icon="images-outline" size="sm" variant="outline" onPress={() => choosePhoto('library')} loading={photoBusy} />
          {photo ? <Button label="Quitar" icon="trash-outline" size="sm" variant="ghost" onPress={() => setPhoto(null)} /> : null}
        </View>
        <Text style={as.muted}>JPEG cuadrado de 256 px (máximo 200 KB).</Text>
      </FormModal>
    </View>
  );
}

// ---------------------------------------------------------------- Duplicados
interface MergePreview {
  primary: { id: number; name: string };
  duplicates: { id: number; name: string; inTrash: boolean }[];
  games: number;
  gameIds: string[];
  tournaments: { id: string; name: string }[];
  conflicts: { type: string; id: string | null; message: string }[];
  canMerge: boolean;
}

export function AdminDuplicates() {
  const groups = useAdminQuery<{ groups: PlayerRow[][] }>('/admin/players/duplicates');
  const all = useAdminQuery<{ players: PlayerRow[] }>('/admin/players?size=100');
  const [manualA, setManualA] = useState(0);
  const [manualB, setManualB] = useState(0);
  const options = [{ value: 0, label: 'Elegir perfil…' }, ...(all.data?.players ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.played} partidas)` }))];

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Duplicados"
        subtitle="Une dos perfiles de la misma persona: elige el principal, revisa la vista previa y confirma. Se aplica todo o nada."
        right={
          <Button
            label="Actualizar"
            icon="refresh"
            size="sm"
            variant="outline"
            onPress={() => {
              groups.reload();
              all.reload();
            }}
          />
        }
      />
      <Text style={as.subTitle}>Posibles duplicados</Text>
      <QueryState {...groups} />
      {!groups.loading && groups.data ? (
        groups.data.groups.length ? (
          groups.data.groups.map((g) => (
            <MergeCard
              key={g.map((p) => p.id).join('-')}
              players={g}
              onDone={() => {
                groups.reload();
                all.reload();
              }}
            />
          ))
        ) : (
          <EmptyState icon="checkmark-done-outline" title="Sin duplicados evidentes" message="No hay perfiles con el mismo nombre (sin contar tildes ni mayúsculas)." />
        )
      ) : null}

      <Text style={as.subTitle}>Fusión manual</Text>
      <Card style={{ gap: space.md }}>
        <Text style={as.muted}>Para nombres distintos de la misma persona (por ejemplo, un apodo).</Text>
        <Select label="Perfil principal (se conserva)" value={manualA} onChange={setManualA} options={options} />
        <Select label="Perfil duplicado (se une al principal)" value={manualB} onChange={setManualB} options={options} />
        {manualA && manualB && manualA !== manualB ? (
          <MergeCard
            key={`${manualA}-${manualB}`}
            fixed={{ primaryId: manualA, duplicateIds: [manualB] }}
            players={(all.data?.players ?? []).filter((p) => p.id === manualA || p.id === manualB)}
            onDone={() => {
              setManualA(0);
              setManualB(0);
              groups.reload();
              all.reload();
            }}
          />
        ) : null}
      </Card>
    </View>
  );
}

function MergeCard({ players, fixed, onDone }: { players: PlayerRow[]; fixed?: { primaryId: number; duplicateIds: number[] }; onDone: () => void }) {
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  // Por defecto, el principal es el perfil con más partidas.
  const [primaryId, setPrimaryId] = useState(fixed?.primaryId ?? [...players].sort((a, b) => b.played - a.played)[0]?.id);
  const duplicateIds = fixed?.duplicateIds ?? players.filter((p) => p.id !== primaryId).map((p) => p.id);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api<MergePreview>('/admin/players/merge/preview', { method: 'POST', body: { primaryId, duplicateIds } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!preview?.canMerge) return;
    const reason = await askReason({
      title: `¿Unir ${preview.duplicates.map((d) => d.name).join(', ')} en ${preview.primary.name}?`,
      message: `Se moverán ${preview.games} partida(s) y ${preview.tournaments.length} torneo(s). Los nombres anteriores quedan como alias. No se puede deshacer automáticamente.`,
      confirmLabel: 'Fusionar',
      destructive: true,
    });
    if (!reason) return;
    setBusy(true);
    try {
      await api('/admin/players/merge', { method: 'POST', body: { primaryId, duplicateIds, reason } });
      toast('Perfiles fusionados');
      void syncNow();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.sm }}>
      {!fixed ? (
        <>
          <Label>Perfil principal</Label>
          <View style={as.wrap}>
            {players.map((p) => (
              <Pill
                key={p.id}
                label={`${p.name} · ${p.played} partidas${p.account ? ' · con cuenta' : ''}`}
                active={p.id === primaryId}
                onPress={() => {
                  setPrimaryId(p.id);
                  setPreview(null);
                }}
              />
            ))}
          </View>
        </>
      ) : null}
      {!preview ? <Button label="Ver vista previa" icon="eye-outline" size="sm" variant="outline" onPress={loadPreview} loading={busy} /> : null}
      {preview ? (
        <View style={{ gap: 6 }}>
          <Text style={as.rowTitle}>
            {preview.duplicates.map((d) => d.name).join(', ')} → {preview.primary.name}
          </Text>
          <Text style={as.muted}>
            Partidas que pasan al principal: {preview.games}
            {preview.tournaments.length ? ` · torneos: ${preview.tournaments.map((t) => t.name).join(', ')}` : ''}
          </Text>
          {preview.gameIds.slice(0, 5).map((id) => (
            <Text key={id} style={as.link} onPress={() => openGame(id)} accessibilityRole="link">
              Ver partida {id}
            </Text>
          ))}
          {preview.conflicts.map((c, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={[as.danger, { flex: 1 }]}>{c.message}</Text>
            </View>
          ))}
          {preview.canMerge ? (
            <Button label="Fusionar" icon="git-merge-outline" variant="danger" onPress={merge} loading={busy} />
          ) : (
            <Text style={as.danger}>No se puede fusionar mientras haya conflictos: produciría participantes duplicados o enfrentamientos inválidos.</Text>
          )}
          <Button label="Cerrar vista previa" variant="ghost" size="sm" onPress={() => setPreview(null)} />
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
