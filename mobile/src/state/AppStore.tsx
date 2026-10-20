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
import * as C from '@/domain/challenge.ts';
import type { Challenge, ChallengeInput } from '@/domain/challenge.ts';
import { backoffDelay, outgoingGame, selectPending } from '@/domain/syncQueue.ts';
import * as T from '@/domain/tournament.ts';
import type { Tournament, TournamentInput } from '@/domain/tournament.ts';
import { storeAppearance } from '@/services/appearance';
import { ApiError, isAdminRole, request, type ServerGame, type User } from '@/services/api';
import { appStorage, storageKind, tokenStore, type StorageKind } from '@/services/storage';
import { activeAppearance } from '@/theme';

const SYNC_BATCH = 50;
const SYNC_INTERVAL_MS = 60_000;
const SYNC_DEBOUNCE_MS = 1500;

export interface SyncStatus {
  syncing: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Aviso del servidor (p. ej. una partida que no se pudo asociar a una temporada). */
  lastWarning?: string | null;
  /** El último intento no llegó al servidor (sin red o servidor caído). */
  offline: boolean;
  /** Partidas con conflicto entre dispositivos, esperando que el usuario elija. */
  conflicts: number;
  /** Pendientes de otra cuenta que usó este dispositivo (no se suben con la cuenta actual). */
  otherAccount: number;
  /** Próximo reintento automático (ISO), si lo hay. */
  retryAt: string | null;
}

/** Acción hecha ahora en este dispositivo (no al cargar ni al sincronizar). La usa el narrador. */
export type LocalAction =
  | { type: 'start'; game: Game }
  | { type: 'hand' | 'edit' | 'undo' | 'remove' | 'cancel'; before: Game; after: Game };

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
  challenges: Challenge[];
  /** Revisión de cada partida confirmada por el servidor (para mostrar «provisional»). */
  syncedRevisions: Record<string, number>;
  /** Dónde se guardan los datos en este dispositivo. */
  storage: StorageKind | null;
  /** Último fallo al guardar en el dispositivo (la acción NO quedó guardada). */
  storageError: string | null;
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
  createChallenge(input: ChallengeInput): Promise<Challenge>;
  /** Empieza la siguiente partida del reto (sus participantes y reglas). */
  startChallengeGame(challengeId: string, starterIndex: number | null): Promise<Game>;
  cancelChallenge(challengeId: string): Promise<void>;
  reopenChallenge(challengeId: string, winsNeeded: number): Promise<void>;
  /** Registra en el historial del reto un resultado nuevo o corregido (p. ej. al cerrar el período). */
  refreshChallenge(challengeId: string): Promise<void>;
  /** Resuelve un conflicto de sincronización: conservar la versión del servidor o la de este dispositivo. */
  resolveConflict(gameId: string, keep: 'servidor' | 'mia'): Promise<void>;
  /** Escucha las acciones hechas en este dispositivo (narrador). Devuelve la función para dejar de escuchar. */
  onLocalAction(listener: (action: LocalAction) => void): () => void;
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
  const repo = useMemo(() => new Repository(appStorage), []);
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [themePending, setThemePending] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({
    syncing: false,
    pending: 0,
    lastSyncAt: null,
    lastError: null,
    offline: false,
    conflicts: 0,
    otherAccount: 0,
    retryAt: null,
  });
  const [storage, setStorage] = useState<StorageKind | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const dataRef = useRef<AppData | null>(null);
  const tokenRef = useRef<string | null>(null);
  const opQueue = useRef<Promise<unknown>>(Promise.resolve());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncing = useRef(false);
  /** Llegaron cambios mientras se sincronizaba: se vuelve a sincronizar al terminar. */
  const again = useRef(false);
  const attempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef<User | null>(null);
  const actionListeners = useRef(new Set<(a: LocalAction) => void>());

  const emit = useCallback((action: LocalAction) => {
    // Nunca bloquea ni rompe el guardado: los oyentes se ejecutan después y sus errores se ignoran.
    setTimeout(() => {
      for (const fn of actionListeners.current) {
        try {
          fn(action);
        } catch {
          // ignorado
        }
      }
    }, 0);
  }, []);

  const applyUser = useCallback(
    (u: User | null) => {
      userRef.current = u;
      setUser(u);
    },
    [],
  );

  /** Guarda en el dispositivo; si falla, avisa y la acción no se muestra como guardada. */
  const durable = useCallback(async <R,>(write: () => Promise<R>): Promise<R> => {
    try {
      const r = await write();
      setStorageError(null);
      return r;
    } catch {
      const msg = 'No se pudo guardar en este dispositivo (¿espacio lleno o almacenamiento bloqueado?). La última acción no quedó registrada.';
      setStorageError(msg);
      throw new G.GameError(msg);
    }
  }, []);
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

  const queueInfo = (d: AppData) => {
    const uid = userRef.current?.id ?? null;
    const g = selectPending(d.games, d.syncedRevisions, uid);
    const t = selectPending(d.tournaments, d.syncedTournamentRevisions, uid);
    const c = selectPending(d.challenges, d.syncedChallengeRevisions, uid);
    return {
      pending: g.send.length + t.send.length + c.send.length,
      otherAccount: g.otherAccount.length + t.otherAccount.length + c.otherAccount.length,
      conflicts: d.games.filter((x) => x.conflict).length,
    };
  };

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    applyUser(null);
    await tokenStore.clear();
    await repo.saveSessionUser(null).catch(() => undefined);
  }, [applyUser, repo]);

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

  const syncNow = useCallback(async (): Promise<void> => {
    const d = dataRef.current;
    if (d) setSync((s) => ({ ...s, ...queueInfo(d) }));
    if (!d || !tokenRef.current || !d.settings.apiUrl) return;
    // Un solo proceso a la vez: si llegan cambios mientras tanto, se repite al terminar.
    if (syncing.current) {
      again.current = true;
      return;
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    syncing.current = true;
    again.current = false;
    setSync((s) => ({ ...s, syncing: true, retryAt: null }));
    let failed = false;
    try {
      const snapshot = dataRef.current!;
      const uid = userRef.current?.id ?? null;
      const pending = selectPending(snapshot.games, snapshot.syncedRevisions, uid).send;
      const pendingTournaments = selectPending(snapshot.tournaments, snapshot.syncedTournamentRevisions, uid).send;
      const pendingChallenges = selectPending(snapshot.challenges, snapshot.syncedChallengeRevisions, uid).send;
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
        const cBatch = i === 0 ? pendingChallenges : [];
        const strip = <X extends { accountId?: number | null }>(x: X) => {
          const { accountId: _a, ...rest } = x;
          return rest;
        };
        const result = await authedRequest<{
          accepted: { id: string }[];
          serverVersions: ServerGame[];
          deleted: string[];
          errors: { id: string | null; error: string }[];
          acceptedTournaments?: { id: string }[];
          serverTournaments?: Tournament[];
          warnings?: { id: string; warning: string; groupId: string | null; seasonId: string | null; challengeId?: string | null }[];
          acceptedChallenges?: { id: string }[];
          conflicts?: string[];
        }>('/sync/games', {
          method: 'POST',
          // Retos y torneos van antes que las partidas (el servidor debe conocerlos primero).
          // pull: el servidor entrega también lo que un administrador corrigió, restauró o creó para esta cuenta.
          body:
            i === 0
              ? {
                  games: batch.map((g) => outgoingGame(g, snapshot.syncedRevisions, snapshot.deviceId)),
                  known,
                  tournaments: tBatch.map(strip),
                  knownTournaments,
                  challenges: cBatch.map((c) => ({ ...strip(c), deviceId: snapshot.deviceId })),
                  pull: true,
                }
              : { games: batch.map((g) => outgoingGame(g, snapshot.syncedRevisions, snapshot.deviceId)), known: [], tournaments: [] },
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
            // Lo creado sin sesión queda desde ahora a nombre de la cuenta que lo subió.
            if (local && local.accountId == null && uid != null) {
              const owned = { ...local, accountId: uid };
              await repo.saveGame(owned);
              games = games.map((g) => (g.id === owned.id ? owned : g));
            }
          }
          // Conflicto: otro dispositivo cambió la partida en el servidor. No se pisa ninguna de las dos
          // versiones: se guarda la del servidor junto a la local hasta que el usuario elija.
          const conflictIds = new Set(result.conflicts ?? []);
          for (const id of conflictIds) {
            const local = games.find((g) => g.id === id);
            const sv = result.serverVersions.find((x) => x.id === id);
            if (!local || !sv) continue;
            const { totals: _t, deletedAt: _d, ownerUserId: _o, ...server } = sv;
            const marked: Game = { ...local, conflict: { server: server as Game, at: now() } };
            await repo.saveGame(marked);
            games = games.map((g) => (g.id === id ? marked : g));
          }
          for (const sv of result.serverVersions) {
            if (conflictIds.has(sv.id)) continue;
            // Un administrador corrigió (o restauró) la partida: la versión del servidor reemplaza la local.
            const { totals: _t, deletedAt: _d, ownerUserId: _o, ...game } = sv;
            const corrected: Game = { ...game, adminLocked: true, accountId: uid };
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
          // Asociación con grupo o temporada que el servidor no aceptó: la copia local se ajusta
          // (sin cambiar la revisión, que ya está sincronizada) para no mostrar datos que no cuentan.
          for (const w of result.warnings ?? []) {
            const local = games.find((g) => g.id === w.id);
            const challengeId = w.challengeId === undefined ? local?.challengeId : w.challengeId;
            if (!local || (local.groupId === w.groupId && local.seasonId === w.seasonId && (local.challengeId ?? null) === (challengeId ?? null))) continue;
            const adjusted = { ...local, groupId: w.groupId, seasonId: w.seasonId, challengeId: challengeId ?? null };
            await repo.saveGame(adjusted);
            games = games.map((g) => (g.id === w.id ? adjusted : g));
          }
          if (result.warnings?.length) setSync((st) => ({ ...st, lastWarning: result.warnings![0].warning }));
          const tSynced = { ...cur.syncedTournamentRevisions };
          const tSent = new Map(tBatch.map((t) => [t.id, t.revision]));
          for (const a of result.acceptedTournaments ?? []) {
            const local = cur.tournaments.find((t) => t.id === a.id);
            if (local && local.revision === tSent.get(a.id)) tSynced[a.id] = local.revision;
          }
          const cSynced = { ...cur.syncedChallengeRevisions };
          const cSent = new Map(cBatch.map((c) => [c.id, c.revision]));
          for (const a of result.acceptedChallenges ?? []) {
            const local = cur.challenges.find((c) => c.id === a.id);
            if (local && local.revision === cSent.get(a.id)) cSynced[a.id] = local.revision;
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
          await repo.saveSyncedChallengeRevisions(cSynced);
          commit({
            ...dataRef.current!,
            games,
            tournaments,
            players: registry,
            knownPlayers: knownNames(registry),
            syncedRevisions: synced,
            syncedTournamentRevisions: tSynced,
            syncedChallengeRevisions: cSynced,
            currentGameId,
          });
        });
        if (result.errors.length) {
          throw new ApiError(400, `El servidor rechazó ${result.errors.length} registro(s): ${result.errors[0].error}`);
        }
      }
      attempt.current = 0;
      setSync((st) => ({ ...st, syncing: false, ...queueInfo(dataRef.current!), lastSyncAt: now(), lastError: null, offline: false }));
    } catch (err) {
      failed = true;
      // Sin respuesta del servidor (sin red, servidor caído o tiempo agotado): no es un error de datos.
      const unreachable = err instanceof ApiError && err.status === 0;
      setSync((s) => ({
        ...s,
        syncing: false,
        ...(dataRef.current ? queueInfo(dataRef.current) : {}),
        offline: unreachable,
        lastError: unreachable ? null : err instanceof Error ? err.message : 'Error de sincronización.',
      }));
    } finally {
      syncing.current = false;
    }
    const d2 = dataRef.current;
    if (again.current && !failed) {
      again.current = false;
      void syncNow();
    } else if (failed && d2 && tokenRef.current && queueInfo(d2).pending > 0) {
      // Reintento automático con espera progresiva (2 s, 4 s, 8 s… hasta 5 min).
      const delay = backoffDelay(attempt.current++);
      setSync((s) => ({ ...s, retryAt: new Date(Date.now() + delay).toISOString() }));
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void syncNow();
      }, delay);
    }
  }, [authedRequest, commit, repo, serial]);

  const scheduleSync = useCallback(() => {
    if (dataRef.current) setSync((s) => ({ ...s, ...queueInfo(dataRef.current!) }));
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
        setStorage(await storageKind());
        setSync((s) => ({ ...s, ...queueInfo(loaded) }));
        const cachedConfig = await repo.loadPublicConfig();
        if (alive && cachedConfig) setPublicConfig(cachedConfig);
        void refreshPublicConfig();
        const token = await tokenStore.get();
        if (token && loaded.settings.apiUrl) {
          tokenRef.current = token;
          try {
            const me = await request<{ user: User }>(loaded.settings.apiUrl, '/auth/me', { token });
            if (alive) applyUser(me.user);
            await repo.saveSessionUser(me.user).catch(() => undefined);
            void syncNow();
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) await clearSession();
            else {
              // Sin conexión: se conserva el token y se usa la última cuenta conocida para saber de
              // quién son las partidas nuevas. La sesión se vuelve a validar al recuperar conexión.
              const cached = await repo.loadSessionUser<User>();
              if (alive && cached) applyUser(cached);
              if (alive) setSync((s) => ({ ...s, offline: true }));
              void syncNow();
            }
          }
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudieron leer los datos guardados.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearSession, commit, repo, syncNow, refreshPublicConfig, applyUser]);

  useEffect(() => {
    // Reintentos al volver a la app, al recuperar la red y periódicamente. Recuperar la red reinicia la
    // espera progresiva; la disponibilidad real se comprueba con la propia petición al servidor.
    const now_ = () => {
      attempt.current = 0;
      void syncNow();
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') now_();
    });
    const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const w = Platform.OS === 'web' && typeof window !== 'undefined' ? window : null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') now_();
    };
    const onOffline = () => setSync((s) => ({ ...s, offline: true }));
    if (w) {
      w.addEventListener('online', now_);
      w.addEventListener('offline', onOffline);
      w.addEventListener('focus', now_);
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      sub.remove();
      clearInterval(interval);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (w) {
        w.removeEventListener('online', now_);
        w.removeEventListener('offline', onOffline);
        w.removeEventListener('focus', now_);
        document.removeEventListener('visibilitychange', onVisible);
      }
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
  /** Registra en el reto de la partida un resultado nuevo o corregido (trazabilidad). */
  const reconcileChallengeOf = useCallback(
    async (challengeId: string | null | undefined): Promise<boolean> => {
      if (!challengeId) return false;
      const cur = dataRef.current!;
      const ch = cur.challenges.find((c) => c.id === challengeId);
      if (!ch) return false;
      const at = now();
      const next = C.reconcileDeclared(ch, C.challengeProgress(ch, cur.games, at), at);
      if (next === ch) return false;
      await repo.saveChallenge(next);
      commit({ ...dataRef.current!, challenges: dataRef.current!.challenges.map((c) => (c.id === ch.id ? next : c)) });
      return true;
    },
    [commit, repo],
  );

  const mutateGame = useCallback(
    (gameId: string, change: (game: Game, at: string) => Game, type: 'hand' | 'edit' | 'undo' | 'remove' | 'cancel') =>
      serial(async () => {
        const cur = dataRef.current!;
        const game = cur.games.find((g) => g.id === gameId);
        if (!game) throw new G.GameError('La partida ya no existe.');
        const locked = lockReasonIn(cur, game);
        if (locked) throw new G.GameError(locked);
        if (game.conflict) throw new G.GameError('Esta partida tiene un conflicto con otro dispositivo: resuélvelo antes de seguir anotando.');
        const next = change(game, now());
        if (next === game) return;
        // Primero se guarda en el dispositivo; solo después se muestra como registrada.
        await durable(() => repo.saveGame(next));
        commit({ ...dataRef.current!, games: dataRef.current!.games.map((g) => (g.id === gameId ? next : g)) });
        await reconcileChallengeOf(next.challengeId).catch(() => undefined);
        emit({ type, before: game, after: next });
        scheduleSync();
      }),
    [commit, repo, scheduleSync, serial, durable, emit, reconcileChallengeOf],
  );

  /** Crea la partida, registrando antes en el registro a las personas nuevas. */
  const insertGame = useCallback(
    (build: (registry: PlayerRecord[]) => { game: Game; registry: PlayerRecord[] }) =>
      serial(async () => {
        const cur = dataRef.current!;
        const built = build(cur.players);
        const { registry } = built;
        const game: Game = { ...built.game, accountId: userRef.current?.id ?? null };
        await durable(async () => {
          if (registry !== cur.players) await repo.saveRegistry(registry);
          await repo.saveGame(game);
          await repo.setCurrent(game.id);
        });
        commit({
          ...dataRef.current!,
          games: [...dataRef.current!.games, game],
          currentGameId: game.id,
          players: registry,
          knownPlayers: knownNames(registry),
        });
        emit({ type: 'start', game });
        scheduleSync();
        return game;
      }),
    [commit, repo, scheduleSync, serial, durable, emit],
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
      challenges: d?.challenges ?? [],
      syncedRevisions: d?.syncedRevisions ?? {},
      storage,
      storageError,
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
        mutateGame(gameId, (g, at) => G.addHand(g, sideId, points, handId, at), 'hand'),
      editHand: (gameId, handId, changes) => mutateGame(gameId, (g, at) => G.editHand(g, handId, changes, at), 'edit'),
      undoLastHand: (gameId) => mutateGame(gameId, (g, at) => G.undoLastHand(g, at), 'undo'),
      removeHand: (gameId, handId) => mutateGame(gameId, (g, at) => G.removeHand(g, handId, at), 'remove'),
      cancelGame: (gameId) => mutateGame(gameId, (g, at) => G.cancelGame(g, at), 'cancel'),
      // Idempotente: si la revancha ya existe (doble toque, fin automático de la celebración más
      // «Jugar de nuevo», renderizados repetidos) se retoma esa misma en lugar de crear otra.
      rematch: (gameId) =>
        serial(async () => {
          const cur = dataRef.current!;
          const game = cur.games.find((g) => g.id === gameId);
          if (!game) throw new G.GameError('La partida ya no existe.');
          if (game.tournamentId) throw new G.GameError('Las partidas de torneo siguen el cuadro: vuelve al torneo para jugar el siguiente enfrentamiento.');
          const existing = G.findRematch(cur.games, gameId);
          if (existing) {
            if (cur.currentGameId !== existing.id) {
              await repo.setCurrent(existing.id);
              commit({ ...dataRef.current!, currentGameId: existing.id });
            }
            return existing;
          }
          // En un reto que sigue abierto, la revancha es la siguiente partida del reto.
          const ch = game.challengeId ? cur.challenges.find((c) => c.id === game.challengeId) : undefined;
          const keepChallenge = !!ch && C.challengeProgress(ch, cur.games, now()).accepting;
          const next: Game = { ...G.createRematch(game, now(), undefined, keepChallenge), accountId: userRef.current?.id ?? null };
          await durable(async () => {
            await repo.saveGame(next);
            await repo.setCurrent(next.id);
          });
          commit({ ...dataRef.current!, games: [...dataRef.current!.games, next], currentGameId: next.id });
          emit({ type: 'start', game: next });
          scheduleSync();
          return next;
        }),
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
          const t: Tournament = { ...T.createTournament(withIds, now()), accountId: userRef.current?.id ?? null };
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
          const game: Game = { ...G.createGame(T.matchGameSetup(t, match, starterIndex), now()), accountId: userRef.current?.id ?? null };
          await durable(async () => {
            await repo.saveGame(game);
            await repo.setCurrent(game.id);
          });
          commit({ ...dataRef.current!, games: [...dataRef.current!.games, game], currentGameId: game.id });
          emit({ type: 'start', game });
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
      createChallenge: (input) =>
        serial(async () => {
          const cur = dataRef.current!;
          const count = input.names.length;
          const resolved = resolvePlayers(cur.players, input.names.slice(0, count), now());
          const ch: Challenge = {
            ...C.createChallenge({ ...input, playerIds: resolved.ids }, now()),
            accountId: userRef.current?.id ?? null,
          };
          await durable(async () => {
            if (resolved.registry.length !== cur.players.length) await repo.saveRegistry(resolved.registry);
            await repo.saveChallenge(ch);
          });
          commit({
            ...dataRef.current!,
            challenges: [...dataRef.current!.challenges, ch],
            players: resolved.registry,
            knownPlayers: knownNames(resolved.registry),
          });
          scheduleSync();
          return ch;
        }),
      startChallengeGame: (challengeId, starterIndex) =>
        serial(async () => {
          const cur = dataRef.current!;
          const ch = cur.challenges.find((c) => c.id === challengeId);
          if (!ch) throw new C.ChallengeError('El reto ya no existe.');
          const blocked = C.cannotStart(ch, C.challengeProgress(ch, cur.games, now()));
          if (blocked) throw new C.ChallengeError(blocked);
          // Si ya hay una partida del reto en curso, se retoma esa (doble toque, reintento).
          const open = cur.games.find((g) => g.challengeId === ch.id && g.status === 'pendiente');
          if (open) {
            await repo.setCurrent(open.id);
            commit({ ...dataRef.current!, currentGameId: open.id });
            return open;
          }
          const game: Game = { ...G.createGame(C.challengeGameSetup(ch, starterIndex), now()), accountId: userRef.current?.id ?? null };
          await durable(async () => {
            await repo.saveGame(game);
            await repo.setCurrent(game.id);
          });
          commit({ ...dataRef.current!, games: [...dataRef.current!.games, game], currentGameId: game.id });
          emit({ type: 'start', game });
          scheduleSync();
          return game;
        }),
      cancelChallenge: (challengeId) =>
        serial(async () => {
          const cur = dataRef.current!;
          const ch = cur.challenges.find((c) => c.id === challengeId);
          if (!ch) return;
          const next = C.cancelChallenge(ch, now());
          if (next === ch) return;
          await durable(() => repo.saveChallenge(next));
          commit({ ...dataRef.current!, challenges: dataRef.current!.challenges.map((c) => (c.id === ch.id ? next : c)) });
          scheduleSync();
        }),
      reopenChallenge: (challengeId, winsNeeded) =>
        serial(async () => {
          const cur = dataRef.current!;
          const ch = cur.challenges.find((c) => c.id === challengeId);
          if (!ch) throw new C.ChallengeError('El reto ya no existe.');
          const next = C.reopenChallenge(ch, C.challengeProgress(ch, cur.games, now()), winsNeeded, now());
          await durable(() => repo.saveChallenge(next));
          commit({ ...dataRef.current!, challenges: dataRef.current!.challenges.map((c) => (c.id === ch.id ? next : c)) });
          scheduleSync();
        }),
      refreshChallenge: (challengeId) =>
        serial(async () => {
          if (await reconcileChallengeOf(challengeId)) scheduleSync();
        }),
      resolveConflict: (gameId, keep) =>
        serial(async () => {
          const cur = dataRef.current!;
          const local = cur.games.find((g) => g.id === gameId);
          if (!local?.conflict) return;
          const server = local.conflict.server;
          const synced = { ...cur.syncedRevisions };
          let next: Game;
          if (keep === 'servidor') {
            next = { ...server, conflict: null, accountId: local.accountId ?? userRef.current?.id ?? null };
            synced[gameId] = server.revision;
          } else {
            // Se conserva la versión de este dispositivo como un cambio nuevo sobre la del servidor.
            next = G.recompute({ ...local, conflict: null, revision: server.revision + 1, adminRevision: server.adminRevision, updatedAt: now() }, now());
            synced[gameId] = server.revision;
          }
          await durable(async () => {
            await repo.saveGame(next);
            await repo.saveSyncedRevisions(synced);
          });
          commit({ ...dataRef.current!, games: dataRef.current!.games.map((g) => (g.id === gameId ? next : g)), syncedRevisions: synced });
          await reconcileChallengeOf(next.challengeId).catch(() => undefined);
          scheduleSync();
        }),
      onLocalAction: (listener) => {
        actionListeners.current.add(listener);
        return () => {
          actionListeners.current.delete(listener);
        };
      },
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
        applyUser(res.user);
        await repo.saveSessionUser(res.user).catch(() => undefined);
        attempt.current = 0;
        void syncNow();
        return res.user;
      },
      logout: clearSession,
      setMyPhoto: async (dataUri) => {
        const res = await authedRequest<{ user: User }>('/auth/me/photo', { method: 'PUT', body: { photo: dataUri } });
        applyUser(res.user);
      },
      api: authedRequest,
    };
  }, [authedRequest, clearSession, commit, data, insertGame, loadError, mutateGame, repo, serial, sync, syncNow, user, scheduleSync, publicConfig, themePending, refreshPublicConfig, storage, storageError, durable, emit, applyUser, reconcileChallengeOf]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore debe usarse dentro de AppStoreProvider');
  return ctx;
}
