// Cola persistente de sincronización (código puro, probado con Node).
//
// Cada partida, torneo y reto guarda una revisión que aumenta con cada cambio (mano nueva, corrección,
// anulación, cancelación). La «operación pendiente» de un registro es su última versión completa:
// está pendiente mientras su revisión no coincida con la última confirmada por el servidor
// (syncedRevisions, guardado en el dispositivo). Así:
// - la cola sobrevive a cerrar la app (se reconstruye con lo guardado);
// - reenviar la misma versión no suma puntos dos veces: el servidor guarda el estado completo de la
//   partida con sus manos (cada una con id propio) y descarta revisiones que ya tiene;
// - nada se da por sincronizado hasta que el servidor confirma esa revisión exacta;
// - las correcciones y anulaciones viajan igual que las manos nuevas (son una revisión más).
// Al enviar se indica la revisión base (la última confirmada en este dispositivo) y el id del
// dispositivo: si otro dispositivo cambió la partida en el servidor desde entonces, el servidor
// responde con un conflicto en lugar de sobrescribir.
import type { Game } from './game.ts';

export const SYNC_BACKOFF_BASE_MS = 2_000;
export const SYNC_BACKOFF_MAX_MS = 5 * 60_000;

/** Espera antes del reintento número `attempt` (0, 1, 2…): 2 s, 4 s, 8 s… hasta 5 min. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  // Variación de ±20 % para que varios dispositivos no reintenten a la vez.
  return Math.round(base * (0.8 + random() * 0.4));
}

interface Revisioned {
  id: string;
  revision: number;
  accountId?: number | null;
}

export interface PendingSelection<T> {
  /** Lo que se envía con la cuenta actual. */
  send: T[];
  /** Pendientes de otra cuenta que usó este dispositivo: no se suben con esta. */
  otherAccount: T[];
}

/** Registros pendientes que puede subir la cuenta `userId` (los sin cuenta los adopta quien sincroniza). */
export function selectPending<T extends Revisioned>(items: T[], synced: Record<string, number>, userId: number | null): PendingSelection<T> {
  const send: T[] = [];
  const otherAccount: T[] = [];
  for (const it of items) {
    if (synced[it.id] === it.revision) continue;
    if ((it as unknown as Game).conflict) continue;
    if (it.accountId != null && it.accountId !== userId) otherAccount.push(it);
    else send.push(it);
  }
  return { send, otherAccount };
}

/** Versión que se envía: la partida sin los datos que solo existen en el dispositivo, más la revisión base. */
export function outgoingGame(game: Game, synced: Record<string, number>, deviceId: string) {
  const { conflict: _c, accountId: _a, ...rest } = game;
  return { ...rest, baseRevision: synced[game.id] ?? null, deviceId };
}

export type SyncKind = 'local' | 'sin-conexion' | 'pendiente' | 'sincronizando' | 'sincronizado' | 'error' | 'conflicto';

export const SYNC_LABEL: Record<SyncKind, string> = {
  local: 'Solo en este dispositivo',
  'sin-conexion': 'Sin conexión: guardando en este dispositivo',
  pendiente: 'Pendiente de sincronizar',
  sincronizando: 'Sincronizando…',
  sincronizado: 'Sincronizado',
  error: 'Error de sincronización',
  conflicto: 'Conflicto entre dispositivos',
};

export function syncKind(s: {
  signedIn: boolean;
  syncing: boolean;
  pending: number;
  conflicts: number;
  offline: boolean;
  lastError: string | null;
}): SyncKind {
  if (!s.signedIn) return 'local';
  if (s.conflicts > 0) return 'conflicto';
  if (s.syncing) return 'sincronizando';
  if (s.offline) return 'sin-conexion';
  if (s.lastError) return 'error';
  if (s.pending > 0) return 'pendiente';
  return 'sincronizado';
}
