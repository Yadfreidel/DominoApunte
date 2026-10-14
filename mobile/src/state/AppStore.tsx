import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as G from '@/domain/game.ts';
import type { Game, GameSetup } from '@/domain/game.ts';
import { mergeKnownPlayers, Repository, type AppData, type Settings } from '@/domain/repository.ts';
import { ApiError, request, type ServerGame, type ServerSettings, type User } from '@/services/api';
import { asyncStorageAdapter, tokenStore } from '@/services/storage';

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
  /** Foto del jugador (data URI) o undefined si no tiene. */
  photoOf(name: string): string | undefined;
  setPhoto(name: string, dataUri: string | null): Promise<void>;
  user: User | null;
  isAdmin: boolean;
  serverManagedSettings: boolean;
  sync: SyncStatus;
  startGame(setup: GameSetup): Promise<Game>;
  addHand(gameId: string, sideId: string, points: number, handId: string): Promise<void>;
  editHand(gameId: string, handId: string, changes: { points?: number; sideId?: string }): Promise<void>;
  undoLastHand(gameId: string): Promise<void>;
  removeHand(gameId: string, handId: string): Promise<void>;
  cancelGame(gameId: string): Promise<void>;
  rematch(gameId: string): Promise<Game>;
  resumeGame(gameId: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  syncNow(): Promise<void>;
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  /** Petición autenticada al servidor. Si la sesión dejó de ser válida, la cierra. */
  api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
}

const StoreContext = createContext<StoreValue | null>(null);

const envApiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
const now = () => new Date().toISOString();

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => new Repository(asyncStorageAdapter), []);
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [serverManagedSettings, setServerManaged] = useState(false);
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
  const serial = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = opQueue.current.then(op, op);
    opQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  const pendingCount = (d: AppData) => d.games.filter((g) => d.syncedRevisions[g.id] !== g.revision).length;

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    setUser(null);
    setServerManaged(false);
    await tokenStore.clear();
  }, []);

  const authedRequest = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
      const apiUrl = dataRef.current?.settings.apiUrl ?? '';
      if (!tokenRef.current) throw new ApiError(401, 'Debes iniciar sesión.');
      try {
        return await request<T>(apiUrl, path, { ...options, token: tokenRef.current });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await clearSession();
        throw err;
      }
    },
    [clearSession],
  );

  const applyServerSettings = useCallback(
    async (server: ServerSettings) => {
      const d = dataRef.current;
      if (!d) return;
      const settings: Settings = {
        ...d.settings,
        targets: server.defaultTargets,
        defaultTarget: server.defaultTarget,
        modes: server.modes,
      };
      await repo.saveSettings(settings);
      commit({ ...dataRef.current!, settings });
      setServerManaged(true);
    },
    [commit, repo],
  );

  const syncNow = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !tokenRef.current || !d.settings.apiUrl || syncing.current) {
      if (d) setSync((s) => ({ ...s, pending: pendingCount(d) }));
      return;
    }
    syncing.current = true;
    setSync((s) => ({ ...s, syncing: true }));
    try {
      const { settings } = await authedRequest<{ settings: ServerSettings }>('/settings');
      await serial(() => applyServerSettings(settings));

      const snapshot = dataRef.current!;
      const pending = snapshot.games.filter((g) => snapshot.syncedRevisions[g.id] !== g.revision);
      // Partidas ya sincronizadas: el servidor avisa si un administrador las corrigió o eliminó.
      const known = snapshot.games
        .filter((g) => snapshot.syncedRevisions[g.id] === g.revision)
        .map((g) => ({ id: g.id, revision: g.revision, adminRevision: g.adminRevision ?? 0 }));
      // Siempre al menos una petición, aunque no haya partidas pendientes.
      for (let i = 0; i === 0 || i < pending.length; i += SYNC_BATCH) {
        const batch = pending.slice(i, i + SYNC_BATCH);
        const result = await authedRequest<{
          accepted: { id: string }[];
          serverVersions: ServerGame[];
          deleted: string[];
          errors: { id: string | null; error: string }[];
        }>('/sync/games', { method: 'POST', body: { games: batch, known: i === 0 ? known : [] } });

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
            // Un administrador corrigió la partida: la versión del servidor reemplaza la local.
            const { totals: _t, ...game } = sv;
            const corrected: Game = { ...game, adminLocked: true };
            await repo.saveGame(corrected);
            games = games.map((g) => (g.id === corrected.id ? corrected : g));
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
          await repo.saveSyncedRevisions(synced);
          commit({ ...cur, games, syncedRevisions: synced, currentGameId });
        });
        if (result.errors.length) {
          throw new ApiError(400, `El servidor rechazó ${result.errors.length} partida(s): ${result.errors[0].error}`);
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
  }, [applyServerSettings, authedRequest, commit, repo, serial]);

  const scheduleSync = useCallback(() => {
    if (dataRef.current) setSync((s) => ({ ...s, pending: pendingCount(dataRef.current!) }));
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
  }, [syncNow]);

  // Carga inicial: recupera partidas, partida en curso y sesión.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await repo.load({ apiUrl: envApiUrl });
        if (!alive) return;
        commit(loaded);
        setSync((s) => ({ ...s, pending: pendingCount(loaded) }));
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
  }, [clearSession, commit, repo, syncNow]);

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

  /** Aplica un cambio a una partida, lo guarda en el dispositivo y solo entonces actualiza la pantalla. */
  const mutateGame = useCallback(
    (gameId: string, change: (game: Game, at: string) => Game) =>
      serial(async () => {
        const cur = dataRef.current!;
        const game = cur.games.find((g) => g.id === gameId);
        if (!game) throw new G.GameError('La partida ya no existe.');
        const next = change(game, now());
        if (next === game) return;
        await repo.saveGame(next);
        commit({ ...dataRef.current!, games: dataRef.current!.games.map((g) => (g.id === gameId ? next : g)) });
        scheduleSync();
      }),
    [commit, repo, scheduleSync, serial],
  );

  const insertGame = useCallback(
    (game: Game) =>
      serial(async () => {
        await repo.saveGame(game);
        await repo.setCurrent(game.id);
        const cur = dataRef.current!;
        const knownPlayers = mergeKnownPlayers(cur.knownPlayers, game.participants.map((p) => p.name));
        await repo.saveKnownPlayers(knownPlayers);
        commit({ ...cur, games: [...cur.games, game], currentGameId: game.id, knownPlayers });
        scheduleSync();
        return game;
      }),
    [commit, repo, scheduleSync, serial],
  );

  const value = useMemo<StoreValue>(() => {
    const d = data;
    const currentGame = d?.currentGameId ? d.games.find((g) => g.id === d.currentGameId) ?? null : null;
    return {
      ready: !!d,
      loadError,
      corrupted: d?.corrupted ?? [],
      games: d?.games ?? [],
      currentGame,
      settings: d?.settings ?? { targets: [100, 150, 200], defaultTarget: 200, modes: { individual: true, parejas: true }, apiUrl: '' },
      knownPlayers: d?.knownPlayers ?? [],
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
          // Un jugador con foto queda también en la lista de jugadores recientes.
          const knownPlayers = dataUri ? mergeKnownPlayers(cur.knownPlayers, [name]) : cur.knownPlayers;
          if (knownPlayers !== cur.knownPlayers) await repo.saveKnownPlayers(knownPlayers);
          commit({ ...cur, photos, knownPlayers });
        }),
      user,
      isAdmin: user?.role === 'admin',
      serverManagedSettings,
      sync,
      startGame: (setup) => insertGame(G.createGame(setup, now())),
      addHand: (gameId, sideId, points, handId) =>
        mutateGame(gameId, (g, at) => G.addHand(g, sideId, points, handId, at)),
      editHand: (gameId, handId, changes) => mutateGame(gameId, (g, at) => G.editHand(g, handId, changes, at)),
      undoLastHand: (gameId) => mutateGame(gameId, (g, at) => G.undoLastHand(g, at)),
      removeHand: (gameId, handId) => mutateGame(gameId, (g, at) => G.removeHand(g, handId, at)),
      cancelGame: (gameId) => mutateGame(gameId, (g, at) => G.cancelGame(g, at)),
      rematch: (gameId) => {
        const game = dataRef.current?.games.find((g) => g.id === gameId);
        if (!game) return Promise.reject(new G.GameError('La partida ya no existe.'));
        return insertGame(G.createRematch(game, now()));
      },
      resumeGame: (gameId) =>
        serial(async () => {
          await repo.setCurrent(gameId);
          commit({ ...dataRef.current!, currentGameId: gameId });
        }),
      updateSettings: (patch) =>
        serial(async () => {
          const settings = { ...dataRef.current!.settings, ...patch };
          await repo.saveSettings(settings);
          commit({ ...dataRef.current!, settings });
        }),
      syncNow,
      login: async (username, password) => {
        const apiUrl = dataRef.current?.settings.apiUrl ?? '';
        const res = await request<{ token: string; user: User }>(apiUrl, '/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        tokenRef.current = res.token;
        await tokenStore.set(res.token);
        setUser(res.user);
        void syncNow();
        return res.user;
      },
      logout: clearSession,
      api: authedRequest,
    };
  }, [authedRequest, clearSession, commit, data, insertGame, loadError, mutateGame, repo, serial, serverManagedSettings, sync, syncNow, user]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore debe usarse dentro de AppStoreProvider');
  return ctx;
}
