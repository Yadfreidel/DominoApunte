// Grupos de juego y temporadas (datos que entrega el servidor) y utilidades de presentación.
import type { Game, Mode } from './game.ts';

export type GroupRole = 'propietario' | 'admin' | 'miembro';
export type SeasonStatus = 'programada' | 'activa' | 'cerrada' | 'finalizada' | 'cancelada';

export const GROUP_ROLE_LABEL: Record<GroupRole, string> = { propietario: 'Propietario', admin: 'Administrador', miembro: 'Miembro' };
export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  programada: 'Programada',
  activa: 'En curso',
  cerrada: 'Cerrando (termina el día siguiente)',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

export interface SeasonInfo {
  id: string;
  name: string;
  status: SeasonStatus;
  modes: Mode[];
  ranking: Mode;
  startsOn: string;
  endsOn: string;
  timezone?: string;
  rules?: { winPoints: number; lossPoints: number };
  champions?: { key: string; name: string }[] | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  photo: string | null;
  timezone: string;
  myRole: GroupRole;
  members?: number;
  seasons?: SeasonInfo[];
}

export interface GroupMember {
  userId: number;
  username: string;
  role: GroupRole;
  joinedAt: string;
  photo: string | null;
  playerName: string | null;
  me: boolean;
}

export interface GroupInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  uses: number;
  maxUses: number | null;
  active: boolean;
}

export interface StandingRow {
  key: string;
  name: string;
  position: number;
  tied: boolean;
  played: number;
  wins: number;
  losses: number;
  points: number;
  winRate: number;
  diff: number;
  h2h: number;
}

export interface Standings {
  rows: StandingRow[];
  champions: { key: string; name: string }[];
  games: number;
  rules: { winPoints: number; lossPoints: number };
}

/** Partida del grupo tal como la entrega el servidor: cada participante con su perfil del servidor. */
export type GroupParticipant = Game['participants'][number] & { serverPlayerId?: number; serverName?: string; hasAccount?: boolean };
export type GroupGame = Omit<Game, 'participants'> & { totals?: Record<string, number>; participants: GroupParticipant[] };

/**
 * Prepara las partidas del grupo para reutilizar las estadísticas de la app: la identidad de cada
 * persona pasa a ser su perfil del servidor (estable para todos los integrantes), no el nombre.
 */
export function forGroupStats(games: GroupGame[]): Game[] {
  return games.map((g): Game => ({
    ...g,
    participants: g.participants.map((p) =>
      p.serverPlayerId ? { id: p.id, name: p.serverName ?? p.name, playerId: `srv-${p.serverPlayerId}` } : { id: p.id, name: p.name },
    ),
  }));
}

/** Reglas de una temporada en palabras, para mostrarlas antes de empezar. */
export function seasonRulesText(s: Pick<SeasonInfo, 'modes' | 'ranking' | 'rules' | 'startsOn' | 'endsOn' | 'timezone'>): string[] {
  const win = s.rules?.winPoints ?? 3;
  const loss = s.rules?.lossPoints ?? 0;
  const modes = s.modes.map((m) => (m === 'parejas' ? 'por parejas' : 'individuales')).join(' y ');
  return [
    `Del ${s.startsOn} al ${s.endsOn}${s.timezone ? ` (hora de ${s.timezone.split('/').pop()?.replace(/_/g, ' ')})` : ''}.`,
    `Cuentan las partidas ${modes} asociadas a la temporada al empezarlas. Las de práctica no cuentan.`,
    `Clasificación ${s.ranking === 'parejas' ? 'por parejas (cada pareja por sus dos integrantes)' : 'individual'}: ${win} ${win === 1 ? 'punto' : 'puntos'} por victoria y ${loss} por derrota. Los puntos de las manos no se suman a la clasificación.`,
    'Desempates: 1) victorias entre los empatados, 2) % de victorias, 3) diferencia de puntos anotados. Si persiste el empate, comparten la posición (y el título, si es el primer lugar).',
    'Las partidas empezadas antes del cierre cuentan si terminan a más tardar el día siguiente a la fecha final.',
  ];
}

/** Zona horaria del dispositivo (para proponerla al crear un grupo). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santo_Domingo';
  } catch {
    return 'America/Santo_Domingo';
  }
}
