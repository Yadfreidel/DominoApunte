// Persistencia local. Cada partida se guarda en su propia clave para que registrar una mano
// escriba solo esa partida. Las escrituras se encolan para conservar el orden.
import type { Game, Mode } from './game.ts';
import { nameKey, normalizeName } from './game.ts';
import { migrateGames, resolvePlayers, type PlayerRecord } from './players.ts';
import type { Tournament } from './tournament.ts';
import type { Appearance } from './appearance.ts';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Settings {
  targets: number[];
  defaultTarget: number;
  modes: Record<Mode, boolean>;
  /** URL base de la API, p. ej. https://domino.midominio.com */
  apiUrl: string;
  /** Muestra los sorteos sin animación. */
  reduceMotion: boolean;
  /** Mantiene la pantalla encendida mientras la app está visible. */
  keepAwake: boolean;
  /** Sonido al ganar una partida (solo si el usuario lo activa). */
  victorySound: boolean;
}

/** Borrador de la pantalla de nueva partida: conserva sorteos confirmados al recargar. */
export interface SetupDraft {
  mode: 'individual' | 'parejas';
  /** true si el usuario eligió la modalidad (si no, se usa la sugerida por el organizador). */
  modeChosen?: boolean;
  countChoice: number;
  names: string[];
  teamNames: [string, string];
  starterIndex: number | null;
  practice: boolean;
  /** Puntos por pase elegidos para esta partida (si el usuario los cambió). */
  passPoints?: number;
}

/** Identidad visual de la app (nombre, logo y textos), definida por el administrador. */
export interface Branding {
  appName: string;
  tagline: string;
  homeText: string;
  /** data URI PNG/JPEG/WebP o null. */
  logo: string | null;
}

export const DEFAULT_BRANDING: Branding = { appName: 'Dominó', tagline: 'Marcador de partidas', homeText: '', logo: null };

/** Configuración pública del servidor: valores predeterminados, identidad visual y tema global. */
export interface PublicConfig {
  settings: {
    defaultTargets: number[];
    defaultTarget: number;
    defaultMode: Mode;
    rules: { passPoints: number };
  };
  branding: Branding;
  appearance: Appearance;
}

export interface GameDefaults {
  targets: number[];
  defaultTarget: number;
  defaultMode: Mode;
  passPoints: number;
}

/**
 * Valores iniciales para una partida nueva: los del organizador (servidor) si existen; si no, los
 * del dispositivo. Son solo sugerencias: el usuario puede cambiarlos en cada partida.
 */
export function gameDefaults(settings: Settings, config: PublicConfig | null): GameDefaults {
  const server = config?.settings;
  const targets = [...new Set([...(server?.defaultTargets ?? []), ...settings.targets])].sort((a, b) => a - b);
  return {
    targets,
    defaultTarget: server?.defaultTarget ?? settings.defaultTarget,
    defaultMode: server?.defaultMode === 'parejas' ? 'parejas' : 'individual',
    passPoints: server?.rules?.passPoints ?? 0,
  };
}

export interface AppData {
  games: Game[];
  currentGameId: string | null;
  settings: Settings;
  knownPlayers: string[];
  /** Registro de jugadores con identificador estable. */
  players: PlayerRecord[];
  tournaments: Tournament[];
  /** Revisión de cada partida ya confirmada por el servidor. */
  syncedRevisions: Record<string, number>;
  /** Revisión de cada torneo ya confirmada por el servidor. */
  syncedTournamentRevisions: Record<string, number>;
  /** Fotos de jugadores (data URI JPEG pequeño), por clave de nombre (ver nameKey). */
  photos: Record<string, string>;
  /** Claves que no se pudieron leer (datos dañados). */
  corrupted: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  targets: [100, 150, 200],
  defaultTarget: 200,
  modes: { individual: true, parejas: true },
  apiUrl: '',
  reduceMotion: false,
  keepAwake: true,
  victorySound: false,
};

const PREFIX = 'domino:v1:';
export const KEYS = {
  index: `${PREFIX}gameIds`,
  game: (id: string) => `${PREFIX}game:${id}`,
  current: `${PREFIX}current`,
  settings: `${PREFIX}settings`,
  players: `${PREFIX}players`,
  synced: `${PREFIX}synced`,
  photoIndex: `${PREFIX}photoKeys`,
  photo: (key: string) => `${PREFIX}photo:${encodeURIComponent(key)}`,
  registry: `${PREFIX}registry`,
  tournamentIndex: `${PREFIX}tournamentIds`,
  tournament: (id: string) => `${PREFIX}tournament:${id}`,
  syncedTournaments: `${PREFIX}syncedTournaments`,
  setupDraft: `${PREFIX}setupDraft`,
  publicConfig: `${PREFIX}publicConfig`,
};

function isTournament(value: unknown): value is Tournament {
  const t = value as Tournament;
  return !!t && typeof t.id === 'string' && Array.isArray(t.entrants) && Array.isArray(t.rounds);
}

function isGame(value: unknown): value is Game {
  const g = value as Game;
  return (
    !!g &&
    typeof g.id === 'string' &&
    Array.isArray(g.sides) &&
    Array.isArray(g.hands) &&
    Array.isArray(g.participants) &&
    typeof g.target === 'number'
  );
}

export function mergeKnownPlayers(known: string[], names: string[]): string[] {
  const map = new Map(known.map((n) => [nameKey(n), n]));
  for (const n of names) {
    const clean = normalizeName(n);
    if (clean) map.set(nameKey(clean), clean);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  private gameIds: string[] = [];
  private photoKeys: string[] = [];
  private tournamentIds: string[] = [];
  private storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readJson<T>(key: string, corrupted: string[]): Promise<T | null> {
    const raw = await this.storage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      corrupted.push(key);
      return null;
    }
  }

  async load(defaults: Partial<Settings> = {}): Promise<AppData> {
    const corrupted: string[] = [];
    const ids = (await this.readJson<string[]>(KEYS.index, corrupted)) ?? [];
    const games: Game[] = [];
    for (const id of ids) {
      const g = await this.readJson<Game>(KEYS.game(id), corrupted);
      if (isGame(g)) games.push(g);
      else if (g != null) corrupted.push(KEYS.game(id));
    }
    this.gameIds = games.map((g) => g.id);
    const stored = (await this.readJson<Partial<Settings>>(KEYS.settings, corrupted)) ?? {};
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...defaults,
      ...stored,
      modes: { ...DEFAULT_SETTINGS.modes, ...defaults.modes, ...stored.modes },
    };
    if (!stored.apiUrl && defaults.apiUrl) settings.apiUrl = defaults.apiUrl;
    let currentGameId = await this.readJson<string>(KEYS.current, corrupted);
    if (currentGameId && !games.some((g) => g.id === currentGameId)) currentGameId = null;
    const photos: Record<string, string> = {};
    for (const key of (await this.readJson<string[]>(KEYS.photoIndex, corrupted)) ?? []) {
      const uri = await this.storage.getItem(KEYS.photo(key));
      if (uri?.startsWith('data:image/')) photos[key] = uri;
    }
    this.photoKeys = Object.keys(photos);

    const tournaments: Tournament[] = [];
    for (const id of (await this.readJson<string[]>(KEYS.tournamentIndex, corrupted)) ?? []) {
      const t = await this.readJson<Tournament>(KEYS.tournament(id), corrupted);
      if (isTournament(t)) tournaments.push(t);
      else if (t != null) corrupted.push(KEYS.tournament(id));
    }
    this.tournamentIds = tournaments.map((t) => t.id);

    // Registro de jugadores: incorpora los nombres de la lista antigua de "jugadores recientes" y
    // vincula por nombre las partidas guardadas antes de que existiera el registro.
    const now = new Date().toISOString();
    let registry = (await this.readJson<PlayerRecord[]>(KEYS.registry, corrupted)) ?? [];
    const legacyNames = (await this.readJson<string[]>(KEYS.players, corrupted)) ?? [];
    const before = registry.length;
    registry = resolvePlayers(registry, legacyNames.filter((n) => normalizeName(n)), now).registry;
    const migrated = migrateGames(games, registry, now);
    registry = migrated.registry;
    for (const g of migrated.changed) await this.storage.setItem(KEYS.game(g.id), JSON.stringify(g));
    if (registry.length !== before || migrated.changed.length) {
      await this.storage.setItem(KEYS.registry, JSON.stringify(registry));
    }

    return {
      games: migrated.games,
      currentGameId,
      photos,
      settings,
      knownPlayers: registry.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'es')),
      players: registry,
      tournaments,
      syncedRevisions: (await this.readJson<Record<string, number>>(KEYS.synced, corrupted)) ?? {},
      syncedTournamentRevisions: (await this.readJson<Record<string, number>>(KEYS.syncedTournaments, corrupted)) ?? {},
      corrupted,
    };
  }

  saveRegistry(registry: PlayerRecord[]): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.registry, JSON.stringify(registry)));
  }

  saveTournament(t: Tournament): Promise<void> {
    return this.enqueue(async () => {
      await this.storage.setItem(KEYS.tournament(t.id), JSON.stringify(t));
      if (!this.tournamentIds.includes(t.id)) {
        const next = [...this.tournamentIds, t.id];
        await this.storage.setItem(KEYS.tournamentIndex, JSON.stringify(next));
        this.tournamentIds = next;
      }
    });
  }

  saveSyncedTournamentRevisions(revisions: Record<string, number>): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.syncedTournaments, JSON.stringify(revisions)));
  }

  async loadPublicConfig(): Promise<PublicConfig | null> {
    const config = await this.readJson<PublicConfig>(KEYS.publicConfig, []);
    return config?.settings && config.branding ? config : null;
  }

  savePublicConfig(config: PublicConfig): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.publicConfig, JSON.stringify(config)));
  }

  async loadDraft(): Promise<SetupDraft | null> {
    const corrupted: string[] = [];
    return this.readJson<SetupDraft>(KEYS.setupDraft, corrupted);
  }

  saveDraft(draft: SetupDraft | null): Promise<void> {
    return this.enqueue(() =>
      draft ? this.storage.setItem(KEYS.setupDraft, JSON.stringify(draft)) : this.storage.removeItem(KEYS.setupDraft),
    );
  }

  /** Guarda la partida y espera a que quede escrita. */
  saveGame(game: Game): Promise<void> {
    return this.enqueue(async () => {
      await this.storage.setItem(KEYS.game(game.id), JSON.stringify(game));
      if (!this.gameIds.includes(game.id)) {
        const next = [...this.gameIds, game.id];
        await this.storage.setItem(KEYS.index, JSON.stringify(next));
        this.gameIds = next;
      }
    });
  }

  deleteGame(id: string): Promise<void> {
    return this.enqueue(async () => {
      const next = this.gameIds.filter((g) => g !== id);
      await this.storage.setItem(KEYS.index, JSON.stringify(next));
      this.gameIds = next;
      await this.storage.removeItem(KEYS.game(id));
    });
  }

  setCurrent(id: string | null): Promise<void> {
    return this.enqueue(() =>
      id ? this.storage.setItem(KEYS.current, JSON.stringify(id)) : this.storage.removeItem(KEYS.current),
    );
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.settings, JSON.stringify(settings)));
  }

  saveKnownPlayers(names: string[]): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.players, JSON.stringify(names)));
  }

  /** Guarda (o borra, con null) la foto de un jugador. */
  savePhoto(key: string, dataUri: string | null): Promise<void> {
    return this.enqueue(async () => {
      if (dataUri) {
        await this.storage.setItem(KEYS.photo(key), dataUri);
        if (!this.photoKeys.includes(key)) {
          const next = [...this.photoKeys, key];
          await this.storage.setItem(KEYS.photoIndex, JSON.stringify(next));
          this.photoKeys = next;
        }
      } else {
        const next = this.photoKeys.filter((k) => k !== key);
        await this.storage.setItem(KEYS.photoIndex, JSON.stringify(next));
        this.photoKeys = next;
        await this.storage.removeItem(KEYS.photo(key));
      }
    });
  }

  saveSyncedRevisions(revisions: Record<string, number>): Promise<void> {
    return this.enqueue(() => this.storage.setItem(KEYS.synced, JSON.stringify(revisions)));
  }
}

/** Almacenamiento en memoria, útil para pruebas. */
export class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}
