import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Mode } from '@/domain/game.ts';
import type { Paged, User } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';
import { formatDateTime } from '../GameSummary';
import { useDialogs } from '../Dialogs';
import { Button, Card, EmptyState, ErrorText, Field, Label, Pill, Select } from '../ui';
import { as, errorMessage, openTournament, Pager, QueryState, SearchField, SectionHeader, useDebounced } from './common';
import { useAdminQuery } from './useAdminQuery';

export interface AdminEntrant {
  id: string;
  name: string;
  players: { playerId: string; name: string }[];
}

export interface AdminMatch {
  id: string;
  round: number;
  index: number;
  roundName: string;
  a: AdminEntrant | null;
  b: AdminEntrant | null;
  state: 'esperando' | 'listo' | 'en_juego' | 'terminado' | 'pase';
  gameId: string | null;
  winner: AdminEntrant | null;
  isBye: boolean;
}

export interface AdminTournament {
  id: string;
  name: string;
  mode: Mode;
  target: number;
  status: 'activo' | 'pausado' | 'cancelado';
  createdAt: string;
  updatedAt: string;
  entrants: AdminEntrant[];
  owner: { id: number; username: string } | null;
  champion: AdminEntrant | null;
  gamesCount: number;
  started: boolean;
  bracket?: AdminMatch[][];
}

export const TOURNAMENT_STATUS = (t: Pick<AdminTournament, 'status' | 'champion'>) =>
  t.status === 'cancelado'
    ? { label: 'Cancelado', color: colors.danger }
    : t.champion
      ? { label: 'Terminado', color: colors.success }
      : t.status === 'pausado'
        ? { label: 'En pausa', color: colors.warning }
        : { label: 'En curso', color: colors.lime };

export function AdminTournaments() {
  const [status, setStatus] = useState<'' | 'activo' | 'pausado' | 'cancelado'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const key = `${status}|${debounced}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }
  const params = new URLSearchParams({ page: String(page), size: '20' });
  if (status) params.set('status', status);
  if (debounced) params.set('search', debounced);
  const q = useAdminQuery<{ tournaments: AdminTournament[] } & Paged>(`/admin/tournaments?${params.toString()}`);

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Torneos"
        subtitle="Crear, pausar, reanudar, cancelar y gestionar participantes"
        right={<Button label={creating ? 'Cerrar' : 'Nuevo torneo'} icon={creating ? 'close' : 'add'} size="sm" onPress={() => setCreating((c) => !c)} />}
      />
      {creating ? (
        <CreateTournament
          onCreated={(id) => {
            setCreating(false);
            q.reload();
            openTournament(id);
          }}
        />
      ) : null}
      <SearchField value={search} onChange={setSearch} placeholder="Buscar torneo…" />
      <View style={as.wrap}>
        <Pill label="Todos" active={status === ''} onPress={() => setStatus('')} />
        <Pill label="Activos" active={status === 'activo'} onPress={() => setStatus('activo')} />
        <Pill label="En pausa" color={colors.warning} active={status === 'pausado'} onPress={() => setStatus('pausado')} />
        <Pill label="Cancelados" color={colors.danger} active={status === 'cancelado'} onPress={() => setStatus('cancelado')} />
      </View>
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.tournaments.length ? (
          <>
            <Card style={{ padding: space.sm }}>
              {q.data.tournaments.map((t, i) => {
                const st = TOURNAMENT_STATUS(t);
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => openTournament(t.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Torneo ${t.name}, ${st.label}`}
                    style={({ pressed }) => [as.listRow, i < q.data!.tournaments.length - 1 && as.rowBorder, pressed && { backgroundColor: colors.pressed }]}
                  >
                    <View style={{ flex: 1, minWidth: 180 }}>
                      <Text style={as.rowTitle}>{t.name}</Text>
                      <Text style={as.muted}>
                        {t.mode === 'parejas' ? 'Parejas' : 'Individual'} · {t.entrants.length} participantes · meta {t.target} · {t.gamesCount} partidas
                        {t.owner ? ` · organiza ${t.owner.username}` : ''} · {formatDateTime(t.createdAt)}
                      </Text>
                      {t.champion ? <Text style={[as.tag, { color: colors.success }]}>Campeón: {t.champion.name}</Text> : null}
                    </View>
                    <Text style={[as.tag, { color: st.color }]}>● {st.label}</Text>
                  </Pressable>
                );
              })}
            </Card>
            <Pager page={q.data.page} size={q.data.size} total={q.data.total} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon="trophy-outline" title="Sin torneos" message="Los torneos creados en la app aparecen al sincronizar; también puedes crearlos aquí." />
        )
      ) : null}
    </View>
  );
}

/** Lista de participantes escrita como texto: uno por línea; en parejas, "Ana y Luis" o "Ana, Luis". */
export function parseEntrants(text: string, mode: Mode): { name?: string; players: string[] }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (mode === 'individual') return { players: [line] };
      const [teamPart, membersPart] = line.includes(':') ? line.split(':', 2) : [undefined, line];
      const players = membersPart
        .split(/,| y /i)
        .map((n) => n.trim())
        .filter(Boolean);
      return { name: teamPart?.trim() || undefined, players };
    });
}

function CreateTournament({ onCreated }: { onCreated: (id: string) => void }) {
  const { api } = useStore();
  const { toast } = useDialogs();
  const users = useAdminQuery<{ users: User[] }>('/admin/users');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('individual');
  const [target, setTarget] = useState('100');
  const [list, setList] = useState('');
  const [ownerId, setOwnerId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const entrants = parseEntrants(list, mode);

  const create = async () => {
    setError(null);
    if (!name.trim()) return setError('Escribe el nombre del torneo.');
    if (entrants.length < 2) return setError('Agrega al menos dos participantes.');
    setSaving(true);
    try {
      const r = await api<{ tournament: AdminTournament }>('/admin/tournaments', {
        method: 'POST',
        body: { name, mode, target: Number(target), entrants, ownerUserId: ownerId || undefined },
      });
      toast('Torneo creado y cuadro sorteado');
      onCreated(r.tournament.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej.: Copa de verano" maxLength={40} />
      <View>
        <Label>Modalidad</Label>
        <View style={as.wrap}>
          <Pill label="Individual" active={mode === 'individual'} onPress={() => setMode('individual')} />
          <Pill label="Por parejas" color={colors.purple} active={mode === 'parejas'} onPress={() => setMode('parejas')} />
        </View>
      </View>
      <Field label="Meta de cada partida" value={target} onChangeText={(t) => setTarget(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" maxLength={5} />
      <Field
        label={mode === 'parejas' ? 'Parejas (una por línea: «Nombre: Ana, Luis» o «Ana y Luis»)' : 'Jugadores (uno por línea)'}
        value={list}
        onChangeText={setList}
        multiline
        style={{ minHeight: 120, paddingTop: 12, textAlignVertical: 'top' }}
      />
      <Text style={as.muted}>
        {entrants.length} participante(s). Los cruces se sortean; si no son 2, 4, 8, 16… algunos reciben un pase automático.
      </Text>
      <Select
        label="Organizador (su app recibe el torneo al sincronizar)"
        value={ownerId}
        onChange={setOwnerId}
        options={[{ value: 0, label: 'Yo' }, ...(users.data?.users ?? []).filter((u) => u.active).map((u) => ({ value: u.id, label: u.username }))]}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Crear y sortear" icon="shuffle" onPress={create} loading={saving} />
    </Card>
  );
}
