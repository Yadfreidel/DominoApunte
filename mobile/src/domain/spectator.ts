// Pantalla grande (espectador): estado del marcador recibido del servidor y de la conexión.
// El espectador consulta el servidor cada pocos segundos; una respuesta más vieja que la que ya
// tiene (revisión menor) se descarta, y al reconectar se toma siempre el estado más reciente.

export interface SpectatorSide {
  id: string;
  name: string;
  members: string[];
  total: number;
}

export interface SpectatorSnapshot {
  revision: number;
  updatedAt: string;
  status: 'pendiente' | 'terminada' | 'cancelada';
  mode: 'individual' | 'parejas';
  target: number;
  winnerSideId: string | null;
  sides: SpectatorSide[];
  lastHand: { sideId: string; points: number; at: string; number: number } | null;
  serverTime: string;
}

export interface SpectatorState {
  data: SpectatorSnapshot | null;
  /** Momento (ms) de la última respuesta correcta. */
  lastOkAt: number | null;
  error: string | null;
  failures: number;
  /** El enlace dejó de ser válido (revocado o partida eliminada): no se reintenta. */
  gone: boolean;
  /** Mano nueva detectada en la última actualización (para animar), o null. */
  scored: { sideId: string; points: number; number: number } | null;
}

export const initialSpectatorState: SpectatorState = { data: null, lastOkAt: null, error: null, failures: 0, gone: false, scored: null };

/** Segundos sin datos nuevos a partir de los cuales el marcador se marca como desactualizado. */
export const STALE_AFTER_MS = 10_000;

export function applySnapshot(state: SpectatorState, snap: SpectatorSnapshot, nowMs: number): SpectatorState {
  const prev = state.data;
  // Respuesta tardía de una consulta anterior: no retrocede el marcador.
  if (prev && snap.revision < prev.revision) return { ...state, lastOkAt: nowMs, error: null, failures: 0 };
  const newHand = snap.lastHand && (!prev?.lastHand || snap.lastHand.number > prev.lastHand.number) ? snap.lastHand : null;
  return {
    data: snap,
    lastOkAt: nowMs,
    error: null,
    failures: 0,
    gone: false,
    scored: prev && newHand ? { sideId: newHand.sideId, points: newHand.points, number: newHand.number } : state.scored,
  };
}

export function applyFailure(state: SpectatorState, message: string, nowMs: number, gone = false): SpectatorState {
  void nowMs;
  return { ...state, error: message, failures: state.failures + 1, gone: state.gone || gone };
}

export type ConnectionStatus = 'conectando' | 'en_vivo' | 'reconectando' | 'desactualizado' | 'no_disponible';

export function connectionStatus(state: SpectatorState, nowMs: number): ConnectionStatus {
  if (state.gone) return 'no_disponible';
  if (!state.data) return state.failures ? 'reconectando' : 'conectando';
  if (state.lastOkAt != null && nowMs - state.lastOkAt > STALE_AFTER_MS) return 'desactualizado';
  return state.failures ? 'reconectando' : 'en_vivo';
}

/** Texto de la victoria para la pantalla grande: «¡Juan y Pedro ganaron!», «215 puntos · se pasaron por 15». */
export function spectatorVictory(snap: SpectatorSnapshot): { headline: string; detail: string } | null {
  if (snap.status !== 'terminada' || !snap.winnerSideId) return null;
  const side = snap.sides.find((s) => s.id === snap.winnerSideId);
  if (!side) return null;
  const plural = side.members.length > 1;
  const over = side.total - snap.target;
  return {
    headline: `¡${side.name} ${plural ? 'ganaron' : 'ganó'}!`,
    detail: over <= 0 ? `¡Meta exacta: ${snap.target} puntos!` : `${side.total} puntos · ¡Se ${plural ? 'pasaron' : 'pasó'} por ${over} ${over === 1 ? 'punto' : 'puntos'}!`,
  };
}
