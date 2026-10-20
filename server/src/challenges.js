// Retos entre amigos: validación de los retos que llegan de un dispositivo y de la asociación de una
// partida nueva con un reto. El progreso (victorias, ganador) se deriva de las partidas en la app con
// las mismas reglas de la partida; aquí solo se garantiza que cada partida asociada sea compatible y
// que una partida pertenezca a un reto como máximo (la asociación no cambia después de crearla).
import { bad, cleanName, ID_RE, MODES } from './http.js';
import { MAX_TARGET } from './domain.js';
import { isValidTimeZone, localDay } from './season.js';

const KINDS = ['primero', 'serie'];
const STATUSES = ['activo', 'cancelado'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const key = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/** Valida un reto enviado por un dispositivo. Devuelve una copia normalizada. */
export function validateIncomingChallenge(c) {
  if (!c || typeof c !== 'object' || !ID_RE.test(c.id ?? '')) throw bad('Reto inválido.');
  const name = cleanName(c.name, 'El nombre del reto');
  if (!KINDS.includes(c.kind)) throw bad('Modalidad de reto inválida.');
  if (!MODES.includes(c.mode)) throw bad('Modalidad de juego del reto inválida.');
  if (!STATUSES.includes(c.status)) throw bad('Estado de reto inválido.');
  if (!Number.isInteger(c.target) || c.target < 1 || c.target > MAX_TARGET) throw bad('Meta del reto inválida.');
  if (!isIso(c.createdAt) || !isIso(c.updatedAt)) throw bad('Fechas del reto inválidas.');
  if (!Number.isInteger(c.revision) || c.revision < 0) throw bad('Revisión del reto inválida.');
  if (typeof c.timeZone !== 'string' || !isValidTimeZone(c.timeZone)) throw bad('Zona horaria del reto inválida.');
  const passPoints = c.rules?.passPoints ?? 0;
  if (!Number.isInteger(passPoints) || passPoints < 0 || passPoints > 1000) throw bad('Reglas del reto inválidas.');
  if (!Array.isArray(c.entrants) || c.entrants.length < 2 || c.entrants.length > 4) throw bad('Participantes del reto inválidos.');
  if (c.mode === 'parejas' && c.entrants.length !== 2) throw bad('Un reto por parejas tiene dos parejas.');
  const seenIds = new Set();
  const seenNames = new Set();
  const entrants = c.entrants.map((e) => {
    if (!ID_RE.test(e?.id ?? '') || seenIds.has(e.id)) throw bad('Participante del reto inválido.');
    seenIds.add(e.id);
    const size = c.mode === 'parejas' ? 2 : 1;
    if (!Array.isArray(e.players) || e.players.length !== size) throw bad('Participante del reto inválido.');
    const players = e.players.map((p) => {
      const pname = cleanName(p?.name, 'El nombre del jugador');
      if (seenNames.has(key(pname))) throw bad('Un jugador no puede estar dos veces en el reto.');
      seenNames.add(key(pname));
      const out = { name: pname };
      if (typeof p.playerId === 'string' && ID_RE.test(p.playerId)) out.playerId = p.playerId;
      return out;
    });
    return { id: e.id, name: cleanName(e.name, 'El nombre del participante'), players };
  });
  let winsNeeded = null;
  let startsOn = null;
  let endsOn = null;
  if (c.kind === 'primero') {
    if (!Number.isInteger(c.winsNeeded) || c.winsNeeded < 1 || c.winsNeeded > 50) throw bad('Victorias necesarias inválidas.');
    winsNeeded = c.winsNeeded;
  } else {
    if (!DAY_RE.test(c.startsOn ?? '') || !DAY_RE.test(c.endsOn ?? '') || c.endsOn < c.startsOn) throw bad('Fechas de la serie inválidas.');
    startsOn = c.startsOn;
    endsOn = c.endsOn;
  }
  const tiePolicy = c.tiePolicy === 'puntos' ? 'puntos' : 'empate';
  const log = (Array.isArray(c.log) ? c.log : [])
    .slice(-200)
    .filter((l) => isIso(l?.at) && typeof l.text === 'string')
    .map((l) => ({ at: l.at, text: l.text.slice(0, 300) }));
  const declared =
    c.declared && Array.isArray(c.declared.winnerIds) && c.declared.winnerIds.every((id) => seenIds.has(id))
      ? { winnerIds: c.declared.winnerIds, tie: !!c.declared.tie, at: isIso(c.declared.at) ? c.declared.at : c.updatedAt }
      : null;
  return {
    id: c.id,
    name,
    kind: c.kind,
    mode: c.mode,
    status: c.status,
    entrants,
    target: c.target,
    rules: passPoints ? { passPoints } : null,
    winsNeeded,
    startsOn,
    endsOn,
    timeZone: c.timeZone,
    tiePolicy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    revision: c.revision,
    declared,
    log,
  };
}

export function rowToChallenge(row) {
  const data = JSON.parse(row.data_json);
  return { ...data, id: row.id, name: row.name, kind: row.kind, mode: row.mode, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}

/** Motivo por el que la partida no es compatible con el reto, o null (mismo criterio que la app). */
export function challengeProblem(ch, game) {
  if (ch.status === 'cancelado') return 'el reto está cancelado';
  if (game.mode !== ch.mode) return 'la modalidad no coincide';
  if (game.target !== ch.target) return 'la meta no coincide';
  if ((game.rules?.passPoints ?? 0) !== (ch.rules?.passPoints ?? 0)) return 'las reglas no coinciden';
  if (game.practice) return 'es una partida de práctica';
  if (game.sides.length !== ch.entrants.length) return 'los participantes no coinciden';
  const used = new Set();
  for (const side of game.sides) {
    const entrant = ch.entrants.find((e) => e.id === side.entrantId);
    if (!entrant || used.has(entrant.id)) return 'los participantes no coinciden';
    used.add(entrant.id);
    const names = side.participantIds.map((id) => key(game.participants.find((p) => p.id === id)?.name)).sort();
    if (names.join('|') !== entrant.players.map((p) => key(p.name)).sort().join('|')) return 'los participantes no coinciden';
  }
  if (ch.kind === 'serie') {
    const day = localDay(game.createdAt, ch.timeZone);
    if (day < ch.startsOn || day > ch.endsOn) return 'la partida empezó fuera del período de la serie';
  }
  return null;
}

/**
 * Asociación de una partida NUEVA con un reto: solo si el reto existe, es de la misma cuenta (o quien
 * sincroniza es administrador) y la partida es compatible. Si no, la partida se guarda sin reto y se
 * avisa al dispositivo.
 */
export async function resolveChallenge(t, user, game, isAdmin) {
  if (!game.challengeId) return { challengeId: null, warning: null };
  const row = await t.get('SELECT * FROM domino.challenges WHERE id = $1', [game.challengeId]);
  const fail = (why) => ({ challengeId: null, warning: `La partida se guardó, pero no cuenta para el reto: ${why}.` });
  if (!row) return fail('el reto no existe en el servidor');
  if (!isAdmin && row.source_user_id != null && row.source_user_id !== user.id) return fail('el reto es de otra cuenta');
  const problem = challengeProblem(rowToChallenge(row), game);
  return problem ? fail(problem) : { challengeId: game.challengeId, warning: null };
}
