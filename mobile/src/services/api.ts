import type { Game, Mode } from '@/domain/game.ts';

export type Role = 'propietario' | 'admin' | 'anotador';

export const isAdminRole = (role: Role | undefined | null) => role === 'propietario' || role === 'admin';
export const ROLE_LABEL: Record<Role, string> = { propietario: 'Propietario', admin: 'Administrador', anotador: 'Anotador' };

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  active: boolean;
  /** Perfil de jugador vinculado a la cuenta (no todos los jugadores tienen cuenta). */
  playerId: number | null;
  /** Foto de perfil de la cuenta (data URI) o null. */
  photo?: string | null;
}

export interface ServerSettings {
  defaultTargets: number[];
  defaultTarget: number;
  defaultMode: Mode;
  modes: Record<Mode, boolean>;
  rules: { passPoints: number };
}

export interface ServerGame extends Game {
  totals: Record<string, number>;
  adminLocked: boolean;
  deletedAt?: string | null;
  ownerUserId?: number | null;
}

export interface PlayerRow {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  photo: string | null;
  deletedAt: string | null;
  account: { id: number; username: string; active: boolean } | null;
  played: number;
  wins: number;
  losses: number;
  pending: number;
  cancelled: number;
  points: number;
  winRate: number;
}

export interface Correction {
  id: number;
  createdAt: string;
  adminUsername: string;
  entity: string;
  entityId: string;
  gameId: string | null;
  action: string;
  reason: string;
  before: unknown;
  after: unknown;
}

export interface Summary {
  players: number;
  activePlayers: number;
  games: number;
  active: number;
  finished: number;
  cancelled: number;
  practice: number;
  trash: number;
  corrections: number;
  activeTournaments: number;
  recentGames: ServerGame[];
  recentActivity: Correction[];
}

export interface Paged {
  total: number;
  page: number;
  size: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 12000;

export function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

export async function request<T>(
  baseUrl: string,
  path: string,
  {
    method = 'GET',
    body,
    token,
    timeoutMs = TIMEOUT_MS,
    signal,
    text = false,
  }: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number; signal?: AbortSignal; text?: boolean } = {},
): Promise<T> {
  if (!baseUrl) throw new ApiError(0, 'Configura la dirección del servidor en Configuración.');
  if (signal?.aborted) throw new ApiError(499, 'Operación cancelada.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCancel = () => controller.abort();
  signal?.addEventListener('abort', onCancel);
  let res: Response;
  try {
    res = await fetch(`${normalizeApiUrl(baseUrl)}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (signal?.aborted) throw new ApiError(499, 'Operación cancelada.');
    if (timedOut) throw new ApiError(0, 'El servidor tardó demasiado en responder. Inténtalo de nuevo.');
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu red o la dirección configurada.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  if (res.status === 204) return undefined as T;
  if (text && res.ok) return (await res.text()) as T;
  let data: { error?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    // respuesta sin JSON
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `El servidor respondió con un error (${res.status}).`);
  }
  return data as T;
}
