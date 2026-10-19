import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FormModal } from '@/components/admin/FormModal';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime, GameSummary } from '@/components/GameSummary';
import { Button, Card, EmptyState, ErrorText, Field, Label, Loading, Pill, Screen, Select } from '@/components/ui';
import type { Mode } from '@/domain/game.ts';
import {
  forGroupStats,
  GROUP_ROLE_LABEL,
  SEASON_STATUS_LABEL,
  seasonRulesText,
  type GroupGame,
  type GroupInvite,
  type GroupMember,
  type GroupRole,
  type GroupSummary,
  type SeasonInfo,
} from '@/domain/groups.ts';
import { computePersonStats, computeTeamStats } from '@/domain/stats.ts';
import { goBackOr } from '@/navigation';
import { appBaseUrl, shareOrCopy } from '@/services/links';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

interface Detail {
  group: GroupSummary;
  members: GroupMember[];
  seasons: SeasonInfo[];
  invites: GroupInvite[];
}

type Tab = 'clasificacion' | 'temporadas' | 'partidas' | 'integrantes' | 'invitar';

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const { confirm, toast } = useDialogs();
  const q = useAdminQuery<Detail>(store.user ? `/groups/${encodeURIComponent(id)}` : null);
  const gq = useAdminQuery<{ games: GroupGame[] }>(store.user ? `/groups/${encodeURIComponent(id)}/games` : null);
  const [tab, setTab] = useState<Tab>('clasificacion');
  const [editing, setEditing] = useState(false);
  const back = () => goBackOr('/grupos');

  if (!store.user) {
    return (
      <Screen header={<AppHeader subtitle="Grupo" />}>
        <EmptyState icon="lock-closed-outline" title="Inicia sesión" message="Los grupos son privados: inicia sesión en Configuración para verlos." />
      </Screen>
    );
  }
  if (q.loading && !q.data) {
    return (
      <Screen header={<AppHeader subtitle="Grupo" />}>
        <Loading />
      </Screen>
    );
  }
  if (!q.data) {
    return (
      <Screen header={<AppHeader subtitle="Grupo" />}>
        <EmptyState icon="alert-circle-outline" title="No se pudo abrir el grupo" message={q.error ?? ''} action={<Button label="Volver" variant="outline" onPress={back} />} />
      </Screen>
    );
  }
  const { group, members, seasons, invites } = q.data;
  const canManage = group.myRole === 'propietario' || group.myRole === 'admin';
  const isOwner = group.myRole === 'propietario';

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo completar.', 'error');
    }
  };

  const leave = async () => {
    const ok = await confirm({ title: `¿Salir de ${group.name}?`, message: 'Tus partidas y resultados se conservan en el grupo.', confirmLabel: 'Salir', destructive: true });
    if (!ok) return;
    try {
      await store.api(`/groups/${group.id}/leave`, { method: 'POST' });
      toast('Saliste del grupo', 'info');
      router.replace('/grupos');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo salir.', 'error');
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'clasificacion', label: 'Clasificación' },
    { key: 'temporadas', label: 'Temporadas' },
    { key: 'partidas', label: 'Partidas' },
    { key: 'integrantes', label: 'Integrantes' },
    ...(canManage ? [{ key: 'invitar' as Tab, label: 'Invitar' }] : []),
  ];

  return (
    <Screen header={<AppHeader subtitle="Grupo" />}>
      <Button label="Grupos" icon="arrow-back" variant="ghost" size="sm" onPress={back} style={{ alignSelf: 'flex-start' }} />
      <Card style={s.head}>
        {group.photo ? <Image source={{ uri: group.photo }} style={s.photo} /> : <Ionicons name="people-circle" size={56} color={colors.purple} />}
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{group.name}</Text>
          {group.description ? <Text style={s.meta}>{group.description}</Text> : null}
          <Text style={s.meta}>
            {members.length} integrantes · tu rol: {GROUP_ROLE_LABEL[group.myRole]}
          </Text>
        </View>
        {canManage ? (
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="Editar grupo" hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Card>
      <View style={s.tabs} accessibilityRole="tablist">
        {tabs.map((t) => (
          <Pill key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>

      {tab === 'clasificacion' ? <GroupRanking games={gq.data?.games ?? null} error={gq.error} /> : null}
      {tab === 'temporadas' ? <Seasons group={group} seasons={seasons} canManage={canManage} onCreated={q.reload} /> : null}
      {tab === 'partidas' ? <GroupGames games={gq.data?.games ?? null} error={gq.error} /> : null}
      {tab === 'integrantes' ? (
        <Card style={{ padding: space.sm }}>
          {members.map((m, i) => (
            <View key={m.userId} style={[s.row, i < members.length - 1 && s.border]}>
              {m.photo ? <Image source={{ uri: m.photo }} style={s.avatar} /> : <Ionicons name="person-circle" size={40} color={colors.textMuted} />}
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>
                  {m.username} {m.me ? <Text style={s.meta}>(tú)</Text> : null}
                </Text>
                <Text style={s.meta}>
                  {GROUP_ROLE_LABEL[m.role]}
                  {m.playerName ? ` · juega como ${m.playerName}` : ''}
                </Text>
              </View>
              {isOwner && !m.me ? (
                <View style={{ width: 150 }}>
                  <Select<GroupRole>
                    value={m.role}
                    onChange={(role) => run(() => store.api(`/groups/${group.id}/members/${m.userId}/role`, { method: 'POST', body: { role } }), 'Rol actualizado')}
                    options={(['propietario', 'admin', 'miembro'] as GroupRole[]).map((r) => ({ value: r, label: GROUP_ROLE_LABEL[r] }))}
                  />
                </View>
              ) : null}
              {!m.me && (isOwner || (canManage && m.role === 'miembro')) ? (
                <Pressable
                  onPress={async () => {
                    const ok = await confirm({ title: `¿Quitar a ${m.username} del grupo?`, message: 'Sus partidas y resultados se conservan.', confirmLabel: 'Quitar', destructive: true });
                    if (ok) await run(() => store.api(`/groups/${group.id}/members/${m.userId}`, { method: 'DELETE' }), 'Integrante quitado');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar a ${m.username}`}
                  hitSlop={8}
                  style={s.iconBtn}
                >
                  <Ionicons name="person-remove-outline" size={20} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <Text style={s.note}>
            Los integrantes son cuentas de la app. En las partidas también pueden jugar invitados sin cuenta: aparecen en la clasificación
            marcados como «invitado».
          </Text>
          <Button label="Salir del grupo" icon="exit-outline" variant="ghost" size="sm" onPress={leave} />
        </Card>
      ) : null}
      {tab === 'invitar' && canManage ? <Invites groupId={group.id} groupName={group.name} invites={invites} onChange={q.reload} /> : null}

      <FormModal
        visible={editing}
        title="Editar grupo"
        fields={[
          { key: 'name', label: 'Nombre', initial: group.name },
          { key: 'description', label: 'Descripción', initial: group.description, multiline: true },
        ]}
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          await store.api(`/groups/${group.id}`, { method: 'PATCH', body: { name: v.name, description: v.description } });
          setEditing(false);
          toast('Grupo actualizado');
          q.reload();
        }}
      />
    </Screen>
  );
}

function GroupRanking({ games, error }: { games: GroupGame[] | null; error: string | null }) {
  const [mode, setMode] = useState<Mode | 'equipos'>('individual');
  const data = useMemo(() => {
    if (!games) return null;
    const prepared = forGroupStats(games);
    const accounts = new Set(games.flatMap((g) => g.participants.filter((p) => p.hasAccount && p.serverPlayerId).map((p) => `srv-${p.serverPlayerId}`)));
    return { persons: computePersonStats(prepared), teams: computeTeamStats(prepared), accounts };
  }, [games]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const rows =
    mode === 'equipos'
      ? data.teams.map((t) => ({ key: t.key, name: t.name, played: t.played, wins: t.wins, losses: t.losses, winRate: t.winRate, current: t.currentStreak, best: t.bestStreak, guest: false }))
      : data.persons[mode].map((p) => ({ key: p.key, name: p.name, played: p.played, wins: p.wins, losses: p.losses, winRate: p.winRate, current: p.currentStreak, best: p.bestStreak, guest: !data.accounts.has(p.key) }));
  return (
    <>
      <View style={s.tabs}>
        <Pill label="Individual" active={mode === 'individual'} onPress={() => setMode('individual')} />
        <Pill label="Por parejas" color={colors.purple} active={mode === 'parejas'} onPress={() => setMode('parejas')} />
        <Pill label="Parejas fijas" color={colors.warning} active={mode === 'equipos'} onPress={() => setMode('equipos')} />
      </View>
      {rows.length === 0 ? (
        <EmptyState icon="podium-outline" title="Sin partidas del grupo" message="Asocia una partida al grupo al crearla (Nueva partida → Grupo y temporada)." />
      ) : (
        <Card style={{ paddingHorizontal: space.sm }}>
          <View style={[s.trow, s.border]}>
            <Text style={[s.tname, s.th]}>#</Text>
            <Text style={[s.tnum, s.th]}>PJ</Text>
            <Text style={[s.tnum, s.th]}>G</Text>
            <Text style={[s.tnum, s.th]}>P</Text>
            <Text style={[s.tpct, s.th]}>%</Text>
            <Text style={[s.tnum, s.th]}>Act.</Text>
            <Text style={[s.tnum, s.th]}>Mejor</Text>
          </View>
          {rows.map((r, i) => (
            <View key={r.key} style={[s.trow, i < rows.length - 1 && s.border]} accessible accessibilityLabel={`${i + 1}. ${r.name}: ${r.wins} ganadas de ${r.played}, racha actual ${r.current}`}>
              <Text style={s.tname} numberOfLines={2}>
                {i + 1}. {r.name}
                {r.guest ? <Text style={s.guest}> (invitado)</Text> : null}
              </Text>
              <Text style={s.tnum}>{r.played}</Text>
              <Text style={[s.tnum, { color: colors.lime }]}>{r.wins}</Text>
              <Text style={[s.tnum, { color: colors.danger }]}>{r.losses}</Text>
              <Text style={s.tpct}>{r.winRate == null ? '—' : `${r.winRate}%`}</Text>
              <Text style={[s.tnum, { color: r.current >= 2 ? colors.warning : colors.text }]}>{r.current}</Text>
              <Text style={[s.tnum, { color: colors.warning }]}>{r.best}</Text>
            </View>
          ))}
          <Text style={s.note}>Estadísticas generales del grupo (todas sus partidas válidas, con o sin temporada). Act.: racha actual · Mejor: mejor racha.</Text>
        </Card>
      )}
    </>
  );
}

function GroupGames({ games, error }: { games: GroupGame[] | null; error: string | null }) {
  const { games: local } = useStore();
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!games) return <Loading />;
  if (!games.length) return <EmptyState icon="grid-outline" title="Sin partidas" message="Todavía no hay partidas asociadas a este grupo." />;
  return (
    <>
      {games.slice(0, 100).map((g) => {
        const mine = local.some((x) => x.id === g.id);
        return (
          <GameSummary
            key={g.id}
            game={g}
            onPress={mine ? () => router.push({ pathname: '/historial/[id]', params: { id: g.id } }) : undefined}
          />
        );
      })}
    </>
  );
}

function Seasons({ group, seasons, canManage, onCreated }: { group: GroupSummary; seasons: SeasonInfo[]; canManage: boolean; onCreated: () => void }) {
  const store = useStore();
  const { toast } = useDialogs();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // Propuesta: desde hoy y durante 30 días.
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(() => new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10));
  const [ranking, setRanking] = useState<Mode>('individual');
  const [modes, setModes] = useState<Mode[]>(['individual']);
  const [win, setWin] = useState('3');
  const [loss, setLoss] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveModes: Mode[] = ranking === 'parejas' ? ['parejas'] : modes;
  const rules = { winPoints: Number(win) || 0, lossPoints: Number(loss) || 0 };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.api(`/groups/${group.id}/seasons`, { method: 'POST', body: { name, startsOn, endsOn, ranking, modes: effectiveModes, rules, timezone: group.timezone } });
      toast('Temporada creada');
      setCreating(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la temporada.');
    } finally {
      setBusy(false);
    }
  };

  const active = seasons.filter((x) => x.status !== 'finalizada' && x.status !== 'cancelada');
  const archive = seasons.filter((x) => x.status === 'finalizada' || x.status === 'cancelada');
  const item = (x: SeasonInfo) => (
    <Pressable
      key={x.id}
      onPress={() => router.push({ pathname: '/grupos/temporada/[id]', params: { id: x.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Temporada ${x.name}, ${SEASON_STATUS_LABEL[x.status]}`}
      style={({ pressed }) => [s.season, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{x.name}</Text>
        <Text style={s.meta}>
          {x.startsOn} → {x.endsOn} · {SEASON_STATUS_LABEL[x.status]} · {x.ranking === 'parejas' ? 'por parejas' : 'individual'}
        </Text>
        {x.champions?.length ? <Text style={[s.meta, { color: colors.warning }]}>Campeón: {x.champions.map((c) => c.name).join(' y ')}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );

  return (
    <>
      {active.length ? active.map(item) : <Text style={s.meta}>No hay una temporada en curso.</Text>}
      {archive.length ? (
        <>
          <Text style={s.subTitle}>Archivo</Text>
          {archive.map(item)}
        </>
      ) : null}
      {canManage ? (
        creating ? (
          <Card style={{ gap: space.md }}>
            <Text style={s.subTitle}>Nueva temporada</Text>
            <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej.: Otoño 2026" maxLength={40} />
            <View style={s.tabs}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Inicio (AAAA-MM-DD)" value={startsOn} onChangeText={setStartsOn} maxLength={10} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Cierre (AAAA-MM-DD)" value={endsOn} onChangeText={setEndsOn} maxLength={10} />
              </View>
            </View>
            <View>
              <Label>Clasificación</Label>
              <View style={s.tabs}>
                <Pill label="Individual" active={ranking === 'individual'} onPress={() => setRanking('individual')} />
                <Pill label="Por parejas" color={colors.purple} active={ranking === 'parejas'} onPress={() => setRanking('parejas')} />
              </View>
            </View>
            {ranking === 'individual' ? (
              <View>
                <Label>Modalidades admitidas</Label>
                <View style={s.tabs}>
                  {(['individual', 'parejas'] as Mode[]).map((m) => (
                    <Pill
                      key={m}
                      label={m === 'individual' ? 'Individual' : 'Por parejas'}
                      active={modes.includes(m)}
                      onPress={() => setModes((cur) => (cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : [...cur, m]))}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <View style={s.tabs}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Puntos por victoria" value={win} onChangeText={(t) => setWin(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" maxLength={3} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Puntos por derrota" value={loss} onChangeText={(t) => setLoss(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" maxLength={3} />
              </View>
            </View>
            <Card style={{ gap: 4 }}>
              <Text style={s.rowTitle}>Reglas (no se podrán cambiar cuando empiece)</Text>
              {seasonRulesText({ modes: effectiveModes, ranking, rules, startsOn, endsOn, timezone: group.timezone }).map((t) => (
                <Text key={t} style={s.meta}>
                  • {t}
                </Text>
              ))}
            </Card>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <View style={s.tabs}>
              <Button label="Cancelar" variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }} />
              <Button label="Crear temporada" icon="flag-outline" onPress={create} loading={busy} disabled={!name.trim()} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Button label="Nueva temporada" icon="add" variant="outline" onPress={() => setCreating(true)} />
        )
      ) : null}
    </>
  );
}

function Invites({ groupId, groupName, invites, onChange }: { groupId: string; groupName: string; invites: GroupInvite[]; onChange: () => void }) {
  const store = useStore();
  const { confirm, toast } = useDialogs();
  const [created, setCreated] = useState<{ code: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await store.api<{ code: string }>(`/groups/${groupId}/invites`, { method: 'POST', body: { days: 7 } });
      setCreated({ code: r.code, link: `${appBaseUrl()}/grupos/unirse?codigo=${encodeURIComponent(r.code)}` });
      onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo crear la invitación.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text style={s.rowTitle}>Invitar al grupo</Text>
        <Text style={s.meta}>
          El código vale 7 días. Quien lo use necesita una cuenta de la app (las crea el administrador). Comparte el código o el enlace solo con
          quien quieras invitar.
        </Text>
        {created ? (
          <View style={s.codeBox}>
            <Text style={s.code} selectable>
              {created.code}
            </Text>
            <Text style={s.meta} selectable numberOfLines={2}>
              {created.link}
            </Text>
            <Button
              label="Compartir invitación"
              icon="share-social-outline"
              size="sm"
              onPress={async () => {
                const r = await shareOrCopy(`Invitación a ${groupName}`, `Únete a «${groupName}» en la app de dominó: ${created.link} (código ${created.code})`);
                if (r === 'copiado') toast('Invitación copiada');
              }}
            />
          </View>
        ) : null}
        <Button label="Crear código de invitación" icon="key-outline" variant={created ? 'outline' : 'primary'} onPress={create} loading={busy} />
      </Card>
      {invites.length ? (
        <Card style={{ padding: space.sm }}>
          {invites.map((inv, i) => (
            <View key={inv.id} style={[s.row, i < invites.length - 1 && s.border]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{inv.active ? 'Activa' : inv.revokedAt ? 'Revocada' : 'Vencida'}</Text>
                <Text style={s.meta}>
                  Creada {formatDateTime(inv.createdAt)} · vence {formatDateTime(inv.expiresAt)} · usada {inv.uses} {inv.uses === 1 ? 'vez' : 'veces'}
                </Text>
              </View>
              {inv.active ? (
                <Button
                  label="Revocar"
                  size="sm"
                  variant="danger"
                  onPress={async () => {
                    const ok = await confirm({ title: '¿Revocar esta invitación?', message: 'El código dejará de funcionar.', confirmLabel: 'Revocar', destructive: true });
                    if (!ok) return;
                    try {
                      await store.api(`/groups/${groupId}/invites/${inv.id}`, { method: 'DELETE' });
                      toast('Invitación revocada', 'info');
                      onChange();
                    } catch (err) {
                      toast(err instanceof Error ? err.message : 'No se pudo revocar.', 'error');
                    }
                  }}
                />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  photo: { width: 56, height: 56, borderRadius: 28 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 26 },
  subTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 20, marginTop: space.sm },
  meta: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textDim, fontSize: 12, marginTop: space.sm, paddingHorizontal: 4 },
  tabs: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: 4, flexWrap: 'wrap' },
  border: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  season: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: space.md },
  codeBox: { gap: 6, borderWidth: 1.5, borderColor: colors.lime, borderRadius: radius.md, padding: space.md, alignItems: 'center' },
  code: { color: colors.lime, fontFamily: fonts.display, fontSize: 40, letterSpacing: 4 },
  trow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 2 },
  th: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  tname: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  guest: { color: colors.textDim, fontSize: 11, fontWeight: '400' },
  tnum: { width: 34, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '700' },
  tpct: { width: 44, textAlign: 'center', color: colors.text, fontSize: 13, fontWeight: '700' },
});
