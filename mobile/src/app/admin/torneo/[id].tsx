import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { as, errorMessage, IconAction, openGame } from '@/components/admin/common';
import { FormModal } from '@/components/admin/FormModal';
import { parseEntrants, TOURNAMENT_STATUS, type AdminEntrant, type AdminMatch, type AdminTournament } from '@/components/admin/tournaments';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime } from '@/components/GameSummary';
import { Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { goBackOr } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, radius, space } from '@/theme';

const STATE_LABEL: Record<AdminMatch['state'], string> = {
  esperando: 'Esperando rivales',
  listo: 'Listo para jugar',
  en_juego: 'En juego',
  terminado: 'Terminado',
  pase: 'Pase automático',
};

export default function AdminTournamentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<{ tournament: AdminTournament }>(`/admin/tournaments/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState<AdminEntrant | null>(null);
  const [redrawing, setRedrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = () => goBackOr({ pathname: '/admin', params: { seccion: 'torneos' } });

  if (q.loading && !q.data) {
    return (
      <Screen header={<AppHeader subtitle="Administración · Torneo" />}>
        <Loading />
      </Screen>
    );
  }
  if (!q.data) {
    return (
      <Screen header={<AppHeader subtitle="Administración · Torneo" />}>
        <EmptyState icon="alert-circle-outline" title="No se pudo abrir el torneo" message={q.error ?? ''} action={<Button label="Volver" variant="outline" onPress={back} />} />
      </Screen>
    );
  }
  const t = q.data.tournament;
  const st = TOURNAMENT_STATUS(t);
  const finished = !!t.champion;
  const editable = t.status !== 'cancelado' && !finished;
  const startedIds = new Set(
    (t.bracket ?? []).flat().filter((m) => m.gameId).flatMap((m) => [m.a?.id, m.b?.id]).filter(Boolean) as string[],
  );

  const action = async (name: 'pausar' | 'reanudar' | 'cancelar') => {
    const titles = {
      pausar: ['¿Pausar el torneo?', 'No se podrán empezar enfrentamientos nuevos hasta reanudarlo.'],
      reanudar: ['¿Reanudar el torneo?', undefined],
      cancelar: ['¿Cancelar el torneo?', 'Las partidas jugadas se conservan en el historial. No se puede deshacer.'],
    } as const;
    const reason = await askReason({ title: titles[name][0], message: titles[name][1], confirmLabel: name[0].toUpperCase() + name.slice(1), destructive: name === 'cancelar' });
    if (!reason) return;
    setBusy(true);
    try {
      const r = await api<{ tournament: AdminTournament }>(`/admin/tournaments/${t.id}`, { method: 'PATCH', body: { action: name, reason } });
      q.setData(r);
      toast(name === 'pausar' ? 'Torneo en pausa' : name === 'reanudar' ? 'Torneo reanudado' : 'Torneo cancelado');
      void syncNow();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Administración · Torneo" />} maxWidth={1100}>
      <Button label="Volver a torneos" icon="arrow-back" variant="ghost" size="sm" onPress={back} style={{ alignSelf: 'flex-start' }} />
      <Card style={{ gap: 6 }}>
        <Text style={s.title}>{t.name}</Text>
        <Text style={[as.tag, { color: st.color }]}>● {st.label}</Text>
        <Text style={as.muted}>
          {t.mode === 'parejas' ? 'Por parejas' : 'Individual'} · meta {t.target} · {t.entrants.length} participantes · {t.gamesCount} partidas
          {t.owner ? ` · organiza ${t.owner.username}` : ''} · creado {formatDateTime(t.createdAt)}
        </Text>
        {t.champion ? <Text style={[as.rowTitle, { color: colors.success }]}>🏆 Campeón: {t.champion.name}</Text> : null}
      </Card>

      {editable ? (
        <View style={as.wrap}>
          {t.status === 'pausado' ? (
            <Button label="Reanudar" icon="play" onPress={() => action('reanudar')} loading={busy} />
          ) : (
            <Button label="Pausar" icon="pause" variant="outline" onPress={() => action('pausar')} loading={busy} />
          )}
          <Button label="Cancelar torneo" icon="close-circle-outline" variant="danger" onPress={() => action('cancelar')} loading={busy} />
          {!t.started ? <Button label="Cambiar participantes y resortear" icon="shuffle" variant="outline" onPress={() => setRedrawing(true)} /> : null}
        </View>
      ) : null}

      <Text style={as.subTitle}>Participantes</Text>
      <Card style={{ padding: space.sm }}>
        {t.entrants.map((e, i) => {
          const played = startedIds.has(e.id);
          return (
            <View key={e.id} style={[as.listRow, i < t.entrants.length - 1 && as.rowBorder]}>
              <View style={{ flex: 1, minWidth: 160 }}>
                <Text style={as.rowTitle}>{e.name}</Text>
                <Text style={as.muted}>
                  {t.mode === 'parejas' ? e.players.map((p) => p.name).join(' y ') : 'Jugador'}
                  {played ? ' · ya jugó (jugadores bloqueados)' : ''}
                </Text>
              </View>
              {editable ? <IconAction icon="create-outline" label={`Editar ${e.name}`} onPress={() => setEditing(e)} /> : null}
            </View>
          );
        })}
      </Card>

      <Text style={as.subTitle}>Cuadro</Text>
      <Text style={as.muted}>
        Para corregir un resultado abre su partida. Un resultado no se puede cambiar si el enfrentamiento siguiente ya empezó.
      </Text>
      <ScrollView horizontal contentContainerStyle={s.bracket}>
        {(t.bracket ?? []).map((round, r) => (
          <View key={r} style={s.column}>
            <Text style={as.rowTitle}>{round[0]?.roundName}</Text>
            {round.map((m) => (
              <View key={m.id} style={[s.match, m.state === 'terminado' && { borderColor: colors.success }]}>
                <Text style={[as.rowTitle, m.winner?.id === m.a?.id && m.winner && { color: colors.lime }]}>{m.a?.name ?? '—'}</Text>
                <Text style={[as.rowTitle, m.winner?.id === m.b?.id && m.winner && { color: colors.lime }]}>{m.b?.name ?? (m.isBye ? 'Pase automático' : '—')}</Text>
                <Text style={as.muted}>{STATE_LABEL[m.state]}</Text>
                {m.gameId ? (
                  <Text style={as.link} onPress={() => openGame(m.gameId!)} accessibilityRole="link">
                    Ver o corregir partida
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <FormModal
        visible={!!editing}
        title={`Editar ${editing?.name ?? ''}`}
        description={
          editing && startedIds.has(editing.id)
            ? 'Ya jugó en el torneo: solo se puede cambiar el nombre de la pareja.'
            : 'Reemplazar un jugador solo es posible si este participante todavía no jugó.'
        }
        fields={[
          ...(t.mode === 'parejas' ? [{ key: 'name', label: 'Nombre de la pareja', initial: editing?.name }] : []),
          ...(editing && !startedIds.has(editing.id)
            ? [{ key: 'players', label: t.mode === 'parejas' ? 'Jugadores (separados por coma)' : 'Jugador', initial: editing.players.map((p) => p.name).join(', ') }]
            : []),
          { key: 'reason', label: 'Motivo', multiline: true },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const body: Record<string, unknown> = { reason: v.reason };
          if (v.name !== undefined && v.name.trim() !== editing!.name) body.name = v.name;
          if (v.players !== undefined) {
            const names = v.players.split(',').map((n) => n.trim()).filter(Boolean);
            if (names.join('|').toLowerCase() !== editing!.players.map((p) => p.name).join('|').toLowerCase()) body.players = names;
          }
          if (Object.keys(body).length === 1) throw new Error('No hay cambios.');
          const r = await api<{ tournament: AdminTournament }>(`/admin/tournaments/${t.id}/entrants/${editing!.id}`, { method: 'PATCH', body });
          q.setData(r);
          setEditing(null);
          toast('Participante actualizado');
          void syncNow();
        }}
      />
      <FormModal
        visible={redrawing}
        title="Participantes y nuevo sorteo"
        description="Solo es posible mientras no se haya jugado ninguna partida. El cuadro se vuelve a sortear."
        fields={[
          {
            key: 'list',
            label: t.mode === 'parejas' ? 'Parejas (una por línea: «Nombre: Ana, Luis»)' : 'Jugadores (uno por línea)',
            multiline: true,
            initial: t.entrants.map((e) => (t.mode === 'parejas' ? `${e.name}: ${e.players.map((p) => p.name).join(', ')}` : e.name)).join('\n'),
          },
          { key: 'reason', label: 'Motivo', multiline: true },
        ]}
        submitLabel="Guardar y resortear"
        onClose={() => setRedrawing(false)}
        onSubmit={async (v) => {
          const r = await api<{ tournament: AdminTournament }>(`/admin/tournaments/${t.id}/entrants`, {
            method: 'PUT',
            body: { entrants: parseEntrants(v.list, t.mode), reason: v.reason },
          });
          q.setData(r);
          setRedrawing(false);
          toast('Cuadro sorteado de nuevo');
          void syncNow();
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  bracket: { gap: space.lg, paddingBottom: space.md },
  column: { width: 230, gap: space.sm },
  match: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: 2, backgroundColor: colors.surface },
});
