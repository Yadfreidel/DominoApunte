// Registro de jugadores: cada persona tiene un identificador estable que se guarda en todas sus
// partidas. Así las estadísticas, los torneos y el historial entre rivales no dependen de cómo se
// escriba el nombre en cada partida.
import type { Game } from './game.ts';
import { nameKey, newId, normalizeName } from './game.ts';

export interface PlayerRecord {
  id: string;
  name: string;
  createdAt: string;
}

export function findPlayerByName(registry: PlayerRecord[], name: string): PlayerRecord | undefined {
  const key = nameKey(name);
  return registry.find((p) => nameKey(p.name) === key);
}

/**
 * Devuelve el id de cada nombre, creando en el registro a las personas nuevas.
 * Un nombre ya registrado (sin distinguir mayúsculas ni espacios) conserva su id.
 */
export function resolvePlayers(
  registry: PlayerRecord[],
  names: string[],
  now: string,
  makeId: () => string = newId,
): { registry: PlayerRecord[]; ids: string[] } {
  const next = [...registry];
  const ids = names.map((raw) => {
    const name = normalizeName(raw);
    const existing = findPlayerByName(next, name);
    if (existing) return existing.id;
    const created = { id: makeId(), name, createdAt: now };
    next.push(created);
    return created.id;
  });
  return { registry: next, ids };
}

/**
 * Migración de datos antiguos (idempotente):
 * - Participantes sin `playerId` (partidas anteriores al registro) se vinculan por nombre exacto;
 *   no se inventa ningún otro dato.
 * - Cualquier `playerId` presente en partidas pero ausente del registro (p. ej. una partida que llegó
 *   del servidor) se vuelve a registrar con el nombre que trae la partida.
 */
export function migrateGames(
  games: Game[],
  registry: PlayerRecord[],
  now: string,
  makeId: () => string = newId,
): { games: Game[]; registry: PlayerRecord[]; changed: Game[] } {
  let reg = [...registry];
  const known = new Set(reg.map((p) => p.id));
  for (const g of games) {
    for (const p of g.participants) {
      if (p.playerId && !known.has(p.playerId)) {
        reg.push({ id: p.playerId, name: normalizeName(p.name), createdAt: g.createdAt || now });
        known.add(p.playerId);
      }
    }
  }
  const changed: Game[] = [];
  const out = games.map((g) => {
    if (g.participants.every((p) => p.playerId)) return g;
    const participants = g.participants.map((p) => {
      if (p.playerId) return p;
      const r = resolvePlayers(reg, [p.name], g.createdAt || now, makeId);
      reg = r.registry;
      return { ...p, playerId: r.ids[0] };
    });
    const migrated = { ...g, participants };
    changed.push(migrated);
    return migrated;
  });
  return { games: out, registry: reg, changed };
}

export function playerName(registry: PlayerRecord[], playerId: string, fallback = '?'): string {
  return registry.find((p) => p.id === playerId)?.name ?? fallback;
}
