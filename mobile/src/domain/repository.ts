// Persistencia local. Cada partida se guarda en su propia clave para que registrar una mano
// escriba solo esa partida. Las escrituras se encolan para conservar el orden.
import type { Game, Mode } from './game.ts';
import { nameKey, normalizeName } from './game.ts';

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
}

export interface AppData {
  games: Game[];
  currentGameId: string | null;
  settings: Settings;
  knownPlayers: string[];
  /** Revisión de cada partida ya confirmada por el servidor. */
  syncedRevisions: Record<string, number>;
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
};

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
    return {
      games,
      currentGameId,
      photos,
      settings,
      knownPlayers: (await this.readJson<string[]>(KEYS.players, corrupted)) ?? [],
      syncedRevisions: (await this.readJson<Record<string, number>>(KEYS.synced, corrupted)) ?? {},
      corrupted,
    };
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
