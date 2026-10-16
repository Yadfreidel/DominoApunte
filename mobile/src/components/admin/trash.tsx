import { useState } from 'react';
import { Text, View } from 'react-native';
import type { PlayerRow, ServerGame } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, space } from '@/theme';
import { useDialogs } from '../Dialogs';
import { formatDateTime, GameSummary } from '../GameSummary';
import { Button, Card, EmptyState } from '../ui';
import { as, errorMessage, openGame, QueryState, SectionHeader } from './common';
import { FormModal } from './FormModal';
import { useAdminQuery } from './useAdminQuery';

interface GameDeps {
  hands: number;
  players: number;
  corrections: number;
  tournament: { id: string; name: string } | null;
  rematches: string[];
}
interface PlayerDeps {
  games: number;
  tournaments: { id: string; name: string }[];
  account: { id: number; username: string } | null;
  aliases: number;
}
interface TrashData {
  games: { game: ServerGame; deletedBy: string | null; dependencies: GameDeps }[];
  players: { player: PlayerRow; deletedBy: string | null; dependencies: PlayerDeps }[];
}

type Purge = { kind: 'game'; id: string; label: string; deps: string[] } | { kind: 'player'; id: number; label: string; deps: string[]; blocked: boolean };

export function AdminTrash() {
  const { api, syncNow } = useStore();
  const { askReason, toast } = useDialogs();
  const q = useAdminQuery<TrashData>('/admin/trash');
  const [purge, setPurge] = useState<Purge | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (kind: 'games' | 'players', id: string | number, label: string) => {
    const reason = await askReason({ title: `¿Restaurar ${label}?`, confirmLabel: 'Restaurar' });
    if (!reason) return;
    setBusy(`${kind}-${id}`);
    try {
      await api(`/admin/trash/${kind}/${id}/restore`, { method: 'POST', body: { reason } });
      toast('Restaurado');
      q.reload();
      void syncNow();
    } catch (err) {
      // Si hay un conflicto el servidor explica el motivo y no restaura nada.
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const gameDeps = (d: GameDeps) => [
    `${d.hands} mano(s) y ${d.players} participación(es) de jugadores se borrarán con la partida`,
    `${d.corrections} registro(s) de auditoría se conservan`,
    ...(d.tournament ? [`Pertenece al torneo «${d.tournament.name}»`] : []),
    ...(d.rematches.length ? [`${d.rematches.length} revancha(s) dejarán de enlazar a esta partida`] : []),
  ];
  const playerDeps = (d: PlayerDeps) => [
    `${d.games} partida(s) en su historial`,
    ...(d.tournaments.length ? [`Torneos: ${d.tournaments.map((t) => t.name).join(', ')}`] : []),
    ...(d.account ? [`Cuenta vinculada: ${d.account.username} (se desvincula, no se borra)`] : []),
    ...(d.aliases ? [`${d.aliases} nombre(s) anterior(es)`] : []),
  ];

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Papelera"
        subtitle="Lo que está aquí no cuenta en estadísticas. Restaura o elimina definitivamente revisando antes sus dependencias."
        right={<Button label="Actualizar" icon="refresh" size="sm" variant="outline" onPress={q.reload} />}
      />
      <QueryState {...q} />
      {!q.loading && q.data ? (
        q.data.games.length + q.data.players.length === 0 ? (
          <EmptyState icon="trash-outline" title="La papelera está vacía" message="Las partidas y perfiles eliminados aparecen aquí." />
        ) : (
          <>
            {q.data.games.length ? <Text style={as.subTitle}>Partidas ({q.data.games.length})</Text> : null}
            {q.data.games.map(({ game, deletedBy, dependencies }) => (
              <Card key={game.id} style={{ gap: space.sm }}>
                <GameSummary game={game} onPress={() => openGame(game.id)} />
                <Text style={as.muted}>
                  En la papelera desde {formatDateTime(game.deletedAt)}
                  {deletedBy ? ` · por ${deletedBy}` : ''}
                </Text>
                {gameDeps(dependencies).map((d) => (
                  <Text key={d} style={as.muted}>
                    • {d}
                  </Text>
                ))}
                <View style={as.wrap}>
                  <Button label="Restaurar" icon="arrow-undo-outline" size="sm" onPress={() => restore('games', game.id, 'la partida')} loading={busy === `games-${game.id}`} />
                  <Button
                    label="Eliminar definitivamente"
                    icon="trash"
                    size="sm"
                    variant="danger"
                    onPress={() => setPurge({ kind: 'game', id: game.id, label: game.sides.map((sd) => sd.name).join(' vs '), deps: gameDeps(dependencies) })}
                  />
                </View>
              </Card>
            ))}
            {q.data.players.length ? <Text style={as.subTitle}>Perfiles de jugador ({q.data.players.length})</Text> : null}
            {q.data.players.map(({ player, deletedBy, dependencies }) => {
              const blocked = dependencies.games > 0 || dependencies.tournaments.length > 0;
              return (
                <Card key={player.id} style={{ gap: space.sm }}>
                  <Text style={as.rowTitle}>{player.name}</Text>
                  <Text style={as.muted}>
                    En la papelera desde {formatDateTime(player.deletedAt)}
                    {deletedBy ? ` · por ${deletedBy}` : ''}
                  </Text>
                  {playerDeps(dependencies).map((d) => (
                    <Text key={d} style={as.muted}>
                      • {d}
                    </Text>
                  ))}
                  {blocked ? (
                    <Text style={[as.tag, { color: colors.warning }]}>
                      Tiene historial: no se puede eliminar definitivamente. Déjalo en la papelera o fusiónalo en «Duplicados».
                    </Text>
                  ) : null}
                  <View style={as.wrap}>
                    <Button label="Restaurar" icon="arrow-undo-outline" size="sm" onPress={() => restore('players', player.id, player.name)} loading={busy === `players-${player.id}`} />
                    <Button
                      label="Eliminar definitivamente"
                      icon="trash"
                      size="sm"
                      variant="danger"
                      disabled={blocked}
                      onPress={() => setPurge({ kind: 'player', id: player.id, label: player.name, deps: playerDeps(dependencies), blocked })}
                    />
                  </View>
                </Card>
              );
            })}
          </>
        )
      ) : null}

      <FormModal
        visible={!!purge}
        destructive
        title={`Eliminar definitivamente: ${purge?.label ?? ''}`}
        description={`${purge?.deps.join('. ') ?? ''}. Esta acción no se puede deshacer. Escribe ELIMINAR para confirmar.`}
        fields={[
          { key: 'confirm', label: 'Confirmación', placeholder: 'ELIMINAR' },
          { key: 'reason', label: 'Motivo', multiline: true },
        ]}
        submitLabel="Eliminar definitivamente"
        onClose={() => setPurge(null)}
        onSubmit={async (v) => {
          if (v.confirm.trim() !== 'ELIMINAR') throw new Error('Escribe ELIMINAR (en mayúsculas) para confirmar.');
          const path = purge!.kind === 'game' ? `/admin/trash/games/${purge!.id}` : `/admin/trash/players/${purge!.id}`;
          await api(path, { method: 'DELETE', body: { reason: v.reason, confirm: 'ELIMINAR' } });
          setPurge(null);
          toast('Eliminado definitivamente');
          q.reload();
          void syncNow();
        }}
      />
    </View>
  );
}
