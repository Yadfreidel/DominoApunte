import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import * as G from '@/domain/game.ts';
import type { Game, GameSetup } from '@/domain/game.ts';
import { resolvePlayers, type PlayerRecord } from '@/domain/players.ts';
import { sameAppearance } from '@/domain/appearance.ts';
import {
  DEFAULT_BRANDING,
  DEFAULT_SETTINGS,
  gameDefaults,
  Repository,
  type AppData,
  type Branding,
  type GameDefaults,
  type PublicConfig,
  type SetupDraft,
  type Settings,
} from '@/domain/repository.ts';
import * as T from '@/domain/tournament.ts';
import type { Tournament, TournamentInput } from '@/domain/tournament.ts';
import { storeAppearance } from '@/services/appearance';
import { ApiError, isAdminRole, request, type ServerGame, type User } from '@/services/api';
import { asyncStorageAdapter, tokenStore } from '@/services/storage';
import { activeAppearance } from '@/theme';

const SYNC_BATCH = 50;
const SYNC_INTERVAL_MS = 60_000;
const SYNC_DEBOUNCE_MS = 1500;

export interface SyncStatus {
  syncing: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface StoreValue {
  ready: boolean;
  loadError: string | null;
  corrupted: string[];
  games: Game[];
  currentGame: Game | null;
  settings: Settings;
  knownPlayers: string[];
  /** Registro de jugadores con identificador estable. */
  players: PlayerRecord[];
  tournaments: Tournament[];
  /** Foto del jugador (data URI) o undefined si no tiene. */
  photoOf(name: string): string | undefined;
  setPhoto(name: string, dataUri: string | null): Promise<void>;
  user: User | null;
  /** Propietario o administrador (la interfaz se adapta; el servidor vuelve a verificarlo siempre). */
  isAdmin: boolean;
  /** Identidad visual definida por el administrador (o la original). */
  branding: Branding;
  /** Valores sugeridos para una partida nueva; el usuario puede cambiarlos. */
  defaults: GameDefaults;
  /** true si llegó un tema global nuevo que se aplicará al volver a abrir la app. */
  themePending: boolean;
  /** Vuelve a leer la configuración pública del servidor (valores predeterminados, identidad, tema). */
  refreshPublicConfig(): Promise<PublicConfig | null>;
  sync: SyncStatus;
  startGame(setup: GameSetup): Promise<Game>;
  addHand(gameId: string, sideId: string, points: number, handId: string): Promise<void>;
  editHand(gameId: string, handId: string, changes: { points?: number; sideId?: string }): Promise<void>;
  undoLastHand(gameId: string): Promise<void>;
  removeHand(gameId: string, handId: string): Promise<void>;
  cancelGame(gameId: string): Promise<void>;
  rematch(gameId: string): Promise<Game>;
  resumeGame(gameId: string): Promise<void>;
  /** Motivo por el que un resultado de torneo ya no se puede cambiar, o null. */
  lockReasonFor(game: Game): string | null;
  createTournament(input: TournamentInput): Promise<Tournament>;
  /** Abre la partida de un enfrentamiento; si ya existe (doble toque, reintento) devuelve esa misma. */
  startTournamentMatch(tournamentId: string, matchId: string, starterIndex: number | null): Promise<Game>;
  cancelTournament(tournamentId: string): Promise<void>;
  loadSetupDraft(): Promise<SetupDraft | null>;
  saveSetupDraft(draft: SetupDraft | null): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  syncNow(): Promise<void>;
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  /** Pone, cambia o (con null) quita la foto de perfil de la cuenta con sesión iniciada. */
  setMyPhoto(dataUri: string | null): Promise<void>;
  /** Petición autenticada al servidor. Si la sesión dejó de ser válida, la cierra. */
  api<T>(path: string, options?: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal; text?: boolean }): Promise<T>;
}

const StoreContext = createContext<StoreValue | null>(null);

const envApiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
const now = () => new Date().toISOString();

const knownNames = (players: PlayerRecord[]) => players.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'es'));

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => new Repository(asyncStorageAdapter), []);
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [themePending, setThemePending] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({ syncing: false, pending: 0, lastSyncAt: null, lastError: null });

  const dataRef = useRef<AppData | null>(null);
  const tokenRef = useRef<string | null>(null);
  const opQueue = useRef<Promise<unknown>>(Promise.resolve());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncing = useRef(false);

  const commit = useCallback((next: AppData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  /** Ejecuta las operaciones de una en una para que nunca se pisen entre sí. */
  const serial = useCallback(<R,>(op: () => Promise<R>): Promise<R> => {
    const run = opQueue.current.then(op, op);
    opQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  const pendingCount = (d: AppData) =>
    d.games.filter((g) => d.syncedRevisions[g.id] !== g.revision).length +
    d.tournaments.filter((t) => d.syncedTournamentRevisions[t.id] !== t.revision).length;

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    setUser(null);
    await tokenStore.clear();
  }, []);

  const authedRequest = useCallback(
    async <R,>(
      path: string,
      options: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal; text?: boolean } = {},
    ): Promise<R> => {
      const apiUrl = dataRef.current?.settings.apiUrl ?? '';
      if (!tokenRef.current) throw new ApiError(401, 'Debes iniciar sesión.');
      try {
        return await request<R>(apiUrl, path, { ...options, token: tokenRef.current });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await clearSession();
        throw err;
      }
    },
    [clearSession],
  );

  /**
   * Configuración pública (no requiere sesión): se guarda en el dispositivo para usarla sin conexión.
   * Un tema global nuevo se guarda para aplicarse desde el primer cuadro la próxima vez que se abra.
   */
  const refreshPublicConfig = useCallback(async (): Promise<PublicConfig | null> => {
    const apiUrl = dataRef.current?.settings.apiUrl;
    if (!apiUrl) return null;
    try {
      const config = await request<PublicConfig>(apiUrl, '/public/config');
      if (!config?.settings || !config.branding || !config.appearance) return null;
      await repo.savePublicConfig(config);
      setPublicConfig(config);
      storeAppearance(config.appearance);
      setThemePending(!sameAppearance(config.appearance, activeAppearance));
      return config;
    } catch {
      return null; // Sin conexión: se siguen usando los valores guardados.
    }
  }, [repo]);

  const syncNow = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !tokenRef.current || !d.settings.apiUrl || syncing.current) {
      if (d) setSync((s) => ({ ...s, pending: pendingCount(d) }));
      return;
    }
    syncing.current = true;
    setSync((s) => ({ ...s, syncing: true }));
    try {
      const snapshot = dataRef.current!;
      const pending = snapshot.games.filter((g) => snapshot.syncedRevisions[g.id] !== g.revision);
      const pendingTournaments = snapshot.tournaments.filter((t) => snapshot.syncedTournamentRevisions[t.id] !== t.revision);
      // Partidas ya sincronizadas: el servidor avisa si un administrador las corrigió o eliminó.
      const known = snapshot.games
        .filter((g) => snapshot.syncedRevisions[g.id] === g.revision)
        .map((g) => ({ id: g.id, revision: g.revision, adminRevision: g.adminRevision ?? 0 }));
      const knownTournaments = snapshot.tournaments
        .filter((t) => snapshot.syncedTournamentRevisions[t.id] === t.revision)
        .map((t) => ({ id: t.id, adminRevision: t.adminRevision ?? 0 }));
      // Siempre al menos una petición, aunque no haya partidas pendientes. Los torneos van primero,
      // para que el servidor conozca el cuadro antes de recibir sus partidas.
      for (let i = 0; i === 0 || i < pending.length; i += SYNC_BATCH) {
        const batch = pending.slice(i, i + SYNC_BATCH);
        const tBatch = i === 0 ? pendingTournaments : [];
        const result = await authedRequest<{
          accepted: { id: string }[];
          serverVersions: ServerGame[];
          deleted: string[];
          errors: { id: string | null; error: string }[];
          acceptedTournaments?: { id: string }[];
          serverTournaments?: Tournament[];
        }>('/sync/games', {
          method: 'POST',
          // pull: el servidor entrega también lo que un administrador corrigió, restauró o creó para esta cuenta.
          body: i === 0 ? { games: batch, known, tournaments: tBatch, knownTournaments, pull: true } : { games: batch, known: [], tournaments: [] },
        });

        await serial(async () => {
          const cur = dataRef.current!;
          const sent = new Map(batch.map((g) => [g.id, g.revision]));
          const synced = { ...cur.syncedRevisions };
          let games = cur.games;
          for (const a of result.accepted) {
            const local = games.find((g) => g.id === a.id);
            // Solo se marca como sincronizada si no cambió mientras se enviaba.
            if (local && local.revision === sent.get(a.id)) synced[a.id] = local.revision;
          }
          for (const sv of result.serverVersions) {
            // Un administrador corrigió (o restauró) la partida: la versión del servidor reemplaza la local.
            const { totals: _t, deletedAt: _d, ownerUserId: _o, ...game } = sv;
            const corrected: Game = { ...game, adminLocked: true };
            await repo.saveGame(corrected);
            games = games.some((g) => g.id === corrected.id) ? games.map((g) => (g.id === corrected.id ? corrected : g)) : [...games, corrected];
            synced[corrected.id] = corrected.revision;
          }
          let currentGameId = cur.currentGameId;
          for (const id of result.deleted) {
            await repo.deleteGame(id);
            games = games.filter((g) => g.id !== id);
            delete synced[id];
            if (currentGameId === id) {
              currentGameId = null;
              await repo.setCurrent(null);
            }
          }
          const tSynced = { ...cur.syncedTournamentRevisions };
          const tSent = new Map(tBatch.map((t) => [t.id, t.revision]));
          for (const a of result.acceptedTournaments ?? []) {
            const local = cur.tournaments.find((t) => t.id === a.id);
            if (local && local.revision === tSent.get(a.id)) tSynced[a.id] = local.revision;
          }
          // Torneos corregidos o creados desde el panel: la versión del servidor reemplaza la local.
          // Sus jugadores se vinculan por nombre con el registro del dispositivo.
          let tournaments = cur.tournaments;
          let registry = cur.players;
          for (const st of result.serverTournaments ?? []) {
            const names = st.entrants.flatMap((e) => e.players.map((p) => p.name));
            const resolved = resolvePlayers(registry, names, now());
            registry = resolved.registry;
            let k = 0;
            const adopted: Tournament = {
              ...st,
              entrants: st.entrants.map((e) => ({ ...e, players: e.players.map((p) => ({ name: p.name, playerId: resolved.ids[k++] })) })),
            };
            await repo.saveTournament(adopted);
            tournaments = tournaments.some((t) => t.id === adopted.id)
              ? tournaments.map((t) => (t.id === adopted.id ? adopted : t))
              : [...tournaments, adopted];
            tSynced[adopted.id] = adopted.revision;
          }
          if (registry !== cur.players) await repo.saveRegistry(registry);
          await repo.saveSyncedRevisions(synced);
          await repo.saveSyncedTournamentRevisions(tSynced);
          commit({
            ...cur,
            games,
            tournaments,
            players: registry,
            knownPlayers: knownNames(registry),
            syncedRevisions: synced,
            syncedTournamentRevisions: tSynced,
            currentGameId,
          });
        });
        if (result.errors.length) {
          throw new ApiError(400, `El servidor rechazó ${result.errors.length} registro(s): ${result.errors[0].error}`);
        }
      }
      setSync({ syncing: false, pending: pendingCount(dataRef.current!), lastSyncAt: now(), lastError: null });
    } catch (err) {
      setSync((s) => ({
        ...s,
        syncing: false,
        pending: dataRef.current ? pendingCount(dataRef.current) : s.pending,
        lastError: err instanceof Error ? err.message : 'Error de sincronización.',
      }));
    } finally {
      syncing.current = false;
    }
  }, [authedRequest, commit, repo, serial]);

  const scheduleSync = useCallback(() => {
    if (dataRef.current) setSync((s) => ({ ...s, pending: pendingCount(dataRef.current!) }));
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
  }, [syncNow]);

  // Carga inicial: recupera partidas, torneos, partida en curso y sesión.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await repo.load({ apiUrl: envApiUrl });
        // La versión publicada (https) no puede hablar con un servidor http de la red local: si quedó
        // guardada una dirección así de antes, se usa la del servidor publicado.
        const httpsPage = Platform.OS === 'web' && globalThis.location?.protocol === 'https:';
        if (httpsPage && loaded.settings.apiUrl.startsWith('http:') && envApiUrl.startsWith('https:')) {
          loaded.settings = { ...loaded.settings, apiUrl: envApiUrl };
          await repo.saveSettings(loaded.settings);
        }
        if (!alive) return;
        commit(loaded);
        setSync((s) => ({ ...s, pending: pendingCount(loaded) }));
        const cachedConfig = await repo.loadPublicConfig();
        if (alive && cachedConfig) setPublicConfig(cachedConfig);
        void refreshPublicConfig();
        const token = await tokenStore.get();
        if (token && loaded.settings.apiUrl) {
          tokenRef.current = token;
          try {
            const me = await request<{ user: User }>(loaded.settings.apiUrl, '/auth/me', { token });
            if (alive) setUser(me.user);
            void syncNow();
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) await clearSession();
            // Sin conexión: se conserva el token y se reintenta más tarde.
          }
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudieron leer los datos guardados.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearSession, commit, repo, syncNow, refreshPublicConfig]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(interval);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [syncNow]);

  const lockReasonIn = (d: AppData, game: Game) => {
    if (!game.tournamentId) return null;
    const t = d.tournaments.find((x) => x.id === game.tournamentId);
    return t ? T.lockReason(t, d.games, game) : null;
  };

  /**
   * Única vía para modificar una partida: aplica el cambio, lo guarda y solo entonces actualiza la
   * pantalla. El torneo, el historial y las estadísticas se derivan de las partidas, así que quedan
   * actualizados con esta misma escritura.
   */
  const mutateGame = useCallback(
    (gameId: string, change: (game: Game, at: string) => Game) =>
      serial(async () => {
        const cur = dataRef.current!;
        const game = cur.games.find((g) => g.id === gameId);
        if (!game) throw new G.GameError('La partida ya no existe.');
        const locked = lockReasonIn(cur, game);
        if (locked) throw new G.GameError(locked);
        const next = change(game, now());
        if (next === game) return;
        await repo.saveGame(next);
        commit({ ...dataRef.current!, games: dataRef.current!.games.map((g) => (g.id === gameId ? next : g)) });
        scheduleSync();
      }),
    [commit, repo, scheduleSync, serial],
  );

  /** Crea la partida, registrando antes en el registro a las personas nuevas. */
  const insertGame = useCallback(
    (build: (registry: PlayerRecord[]) => { game: Game; registry: PlayerRecord[] }) =>
      serial(async () => {
        const cur = dataRef.current!;
        const { game, registry } = build(cur.players);
        if (registry !== cur.players) await repo.saveRegistry(registry);
        await repo.saveGame(game);
        await repo.setCurrent(game.id);
        commit({
          ...dataRef.current!,
          games: [...dataRef.current!.games, game],
          currentGameId: game.id,
          players: registry,
          knownPlayers: knownNames(registry),
        });
        scheduleSync();
        return game;
      }),
    [commit, repo, scheduleSync, serial],
  );

  const buildFromSetup = (setup: GameSetup) => (registry: PlayerRecord[]) => {
    const count = setup.mode === 'parejas' ? 4 : setup.playerCount;
    const problem = G.validateSetup(setup);
    if (problem) throw new G.GameError(problem);
    let ids = setup.playerIds?.slice(0, count);
    let reg = registry;
    if (!ids || ids.length < count || ids.some((x) => !x)) {
      const r = resolvePlayers(registry, setup.names.slice(0, count), now());
      ids = r.ids;
      reg = r.registry;
    }
    return { game: G.createGame({ ...setup, playerIds: ids }, now()), registry: reg };
  };

  const value = useMemo<StoreValue>(() => {
    const d = data;
    const currentGame = d?.currentGameId ? d.games.find((g) => g.id === d.currentGameId) ?? null : null;
    return {
      ready: !!d,
      loadError,
      corrupted: d?.corrupted ?? [],
      games: d?.games ?? [],
      currentGame,
      settings: d?.settings ?? DEFAULT_SETTINGS,
      knownPlayers: d?.knownPlayers ?? [],
      players: d?.players ?? [],
      tournaments: d?.tournaments ?? [],
      photoOf: (name) => d?.photos[G.nameKey(name)],
      setPhoto: (name, dataUri) =>
        serial(async () => {
          const key = G.nameKey(name);
          if (!key) throw new G.GameError('Escribe el nombre del jugador antes de ponerle foto.');
          await repo.savePhoto(key, dataUri);
          const cur = dataRef.current!;
          const photos = { ...cur.photos };
          if (dataUri) photos[key] = dataUri;
          else delete photos[key];
          // Un jugador con foto queda también en el registro de jugadores.
          let players = cur.players;
          if (dataUri) {
            const r = resolvePlayers(cur.players, [name], now());
            if (r.registry.length !== cur.players.length) {
              players = r.registry;
              await repo.saveRegistry(players);
            }
          }
          commit({ ...cur, photos, players, knownPlayers: knownNames(players) });
        }),
      user,
      isAdmin: isAdminRole(user?.role),
      branding: publicConfig?.branding ?? DEFAULT_BRANDING,
      defaults: gameDefaults(d?.settings ?? DEFAULT_SETTINGS, publicConfig),
      themePending,
      refreshPublicConfig,
      sync,
      startGame: (setup) => insertGame(buildFromSetup(setup)),
      addHand: (gameId, sideId, points, handId) =>
        mutateGame(gameId, (g, at) => G.addHand(g, sideId, points, handId, at)),
      editHand: (gameId, handId, changes) => mutateGame(gameId, (g, at) => G.editHand(g, handId, changes, at)),
      undoLastHand: (gameId) => mutateGame(gameId, (g, at) => G.undoLastHand(g, at)),
      removeHand: (gameId, handId) => mutateGame(gameId, (g, at) => G.removeHand(g, handId, at)),
      cancelGame: (gameId) => mutateGame(gameId, (g, at) => G.cancelGame(g, at)),
      rematch: (gameId) => {
        const game = dataRef.current?.games.find((g) => g.id === gameId);
        if (!game) return Promise.reject(new G.GameError('La partida ya no existe.'));
        return insertGame((registry) => ({ game: G.createRematch(game, now()), registry }));
      },
      resumeGame: (gameId) =>
        serial(async () => {
          await repo.setCurrent(gameId);
          commit({ ...dataRef.current!, currentGameId: gameId });
        }),
      lockReasonFor: (game) => (d ? lockReasonIn(d, game) : null),
      createTournament: (input) =>
        serial(async () => {
          // Las personas nuevas entran al registro para tener un id estable en todas sus partidas.
          const cur = dataRef.current!;
          const names = input.entrants.flatMap((e) => e.players.map((p) => p.name));
          const resolved = resolvePlayers(cur.players, names, now());
          let k = 0;
          const withIds: TournamentInput = {
            ...input,
            entrants: input.entrants.map((e) => ({
              ...e,
              players: e.players.map((p) => ({ name: p.name, playerId: resolved.ids[k++] })),
            })),
          };
          const t = T.createTournament(withIds, now());
          if (resolved.registry.length !== cur.players.length) await repo.saveRegistry(resolved.registry);
          await repo.saveTournament(t);
          commit({
            ...dataRef.current!,
            tournaments: [...dataRef.current!.tournaments, t],
            players: resolved.registry,
            knownPlayers: knownNames(resolved.registry),
          });
          scheduleSync();
          return t;
        }),
      startTournamentMatch: (tournamentId, matchId, starterIndex) =>
        serial(async () => {
          const cur = dataRef.current!;
          const t = cur.tournaments.find((x) => x.id === tournamentId);
          if (!t) throw new T.TournamentError('El torneo ya no existe.');
          const existing = T.matchGame(t, matchId, cur.games);
          if (existing) {
            await repo.setCurrent(existing.id);
            commit({ ...dataRef.current!, currentGameId: existing.id });
            return existing;
          }
          const match = T.findMatch(T.resolveTournament(t, cur.games), matchId);
          if (!match) throw new T.TournamentError('El enfrentamiento no existe.');
          const game = G.createGame(T.matchGameSetup(t, match, starterIndex), now());
          await repo.saveGame(game);
          await repo.setCurrent(game.id);
          commit({ ...dataRef.current!, games: [...dataRef.current!.games, game], currentGameId: game.id });
          scheduleSync();
          return game;
        }),
      cancelTournament: (tournamentId) =>
        serial(async () => {
          const cur = dataRef.current!;
          const t = cur.tournaments.find((x) => x.id === tournamentId);
          if (!t) return;
          const next = T.cancelTournament(t, now());
          if (next === t) return;
          await repo.saveTournament(next);
          commit({ ...cur, tournaments: cur.tournaments.map((x) => (x.id === t.id ? next : x)) });
          scheduleSync();
        }),
      loadSetupDraft: () => repo.loadDraft(),
      saveSetupDraft: (draft) => repo.saveDraft(draft),
      updateSettings: (patch) =>
        serial(async () => {
          const settings = { ...dataRef.current!.settings, ...patch };
          await repo.saveSettings(settings);
          commit({ ...dataRef.current!, settings });
        }),
      syncNow,
      login: async (login, password) => {
        const apiUrl = dataRef.current?.settings.apiUrl ?? '';
        // El servidor acepta correo o nombre de usuario.
        const res = await request<{ token: string; user: User }>(apiUrl, '/auth/login', {
          method: 'POST',
          body: { username: login, password },
        });
        tokenRef.current = res.token;
        await tokenStore.set(res.token);
        setUser(res.user);
        void syncNow();
        return res.user;
      },
      logout: clearSession,
      setMyPhoto: async (dataUri) => {
        const res = await authedRequest<{ user: User }>('/auth/me/photo', { method: 'PUT', body: { photo: dataUri } });
        setUser(res.user);
      },
      api: authedRequest,
    };
  }, [authedRequest, clearSession, commit, data, insertGame, loadError, mutateGame, repo, serial, sync, syncNow, user, scheduleSync, publicConfig, themePending, refreshPublicConfig]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore debe usarse dentro de AppStoreProvider');
  return ctx;
}
