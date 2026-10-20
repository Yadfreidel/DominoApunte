// Grupos de juego, invitaciones, temporadas, pantalla grande (espectadores) y cierre de temporadas.
// Todos los permisos se verifican aquí, en el servidor, en cada petición. Los roles de un grupo
// (propietario, admin, miembro) no dan permisos globales en la app.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createLoginLimiter, isAdminRole } from './auth.js';
import { bad, HttpError, ID_RE, notFound } from './http.js';
import { newId } from './tournament.js';
import { associationProblem, computeStandings, isValidTimeZone, seasonStatus, validateSeasonInput } from './season.js';
import { validateImage } from './validation.js';

const forbidden = (message = 'No tienes permiso para esto.') => new HttpError(403, message);
const conflict = (message) => new HttpError(409, message);
const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const ROLES = ['propietario', 'admin', 'miembro'];
const ROLE_RANK = { propietario: 3, admin: 2, miembro: 1 };
// Sin letras ni números que se confunden (O/0, I/1/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_DAYS = 7;

export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function newInviteCode() {
  let c = '';
  for (let i = 0; i < 8; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

function cleanText(value, field, max, required = false) {
  const v = typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ') : '';
  if (required && !v) throw bad(`${field} es obligatorio.`);
  if (v.length > max) throw bad(`${field} no puede superar ${max} caracteres.`);
  return v;
}

function seasonFromRow(r) {
  return {
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    timezone: r.timezone,
    modes: JSON.parse(r.modes_json),
    ranking: r.ranking,
    rules: JSON.parse(r.rules_json),
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    finalizedAt: r.finalized_at,
    final: r.final_json ? JSON.parse(r.final_json) : null,
  };
}

/**
 * Perfil de jugador del servidor para cada participante (mismo criterio con el que se guardó la
 * partida: nombre o nombre anterior de un perfil). Se usa para clasificaciones y estadísticas del
 * grupo con identificadores estables del servidor.
 */
export async function annotatePlayers(t, games) {
  const names = [...new Set(games.flatMap((g) => g.participants.map((p) => p.name.toLowerCase())))];
  if (!names.length) return games;
  const direct = await t.all('SELECT id, name, lower(name) AS k FROM domino.players WHERE lower(name) = ANY($1::text[])', [names]);
  const aliases = await t.all(
    'SELECT a.alias_key AS k, p.id, p.name FROM domino.player_aliases a JOIN domino.players p ON p.id = a.player_id WHERE a.alias_key = ANY($1::text[])',
    [names],
  );
  const accounts = await t.all('SELECT player_id FROM domino.users WHERE player_id IS NOT NULL AND active = 1');
  const withAccount = new Set(accounts.map((a) => a.player_id));
  const map = new Map();
  for (const a of aliases) map.set(a.k, { id: a.id, name: a.name });
  for (const d of direct) map.set(d.k, { id: d.id, name: d.name });
  return games.map((g) => ({
    ...g,
    participants: g.participants.map((p) => {
      const sp = map.get(p.name.toLowerCase());
      return sp ? { ...p, serverPlayerId: sp.id, serverName: sp.name, hasAccount: withAccount.has(sp.id) } : p;
    }),
  }));
}

export const sidePlayersOf = (g, side) =>
  side.participantIds
    .map((pid) => g.participants.find((p) => p.id === pid))
    .filter((p) => p && p.serverPlayerId)
    .map((p) => ({ id: p.serverPlayerId, name: p.serverName ?? p.name }));

/**
 * Asociación de una partida nueva con un grupo y una temporada al sincronizarla. Solo se acepta si
 * la cuenta pertenece al grupo y la temporada admite la partida; si no, la partida se guarda sin
 * esa asociación (nunca se pierde la partida). Devuelve { groupId, seasonId, warning }.
 */
export async function resolveAssociation(t, user, game, nowIso) {
  if (!game.groupId) return { groupId: null, seasonId: null, warning: null };
  const member = await t.get(
    'SELECT m.role FROM domino.group_members m JOIN domino.groups g ON g.id = m.group_id WHERE m.group_id = $1 AND m.user_id = $2 AND g.archived_at IS NULL',
    [game.groupId, user.id],
  );
  if (!member) return { groupId: null, seasonId: null, warning: 'No perteneces a ese grupo: la partida se guardó sin grupo.' };
  if (!game.seasonId) return { groupId: game.groupId, seasonId: null, warning: null };
  const row = await t.get('SELECT * FROM domino.seasons WHERE id = $1 AND group_id = $2', [game.seasonId, game.groupId]);
  if (!row) return { groupId: game.groupId, seasonId: null, warning: 'La temporada no existe en el grupo.' };
  // La asociación se valida con el momento en que empezó la partida (una partida jugada sin
  // conexión se puede sincronizar después, pero solo si empezó dentro de la temporada).
  const season = seasonFromRow(row);
  // Una temporada finalizada ya no admite incorporaciones, aunque la partida haya empezado dentro.
  if (seasonStatus(season, nowIso) === 'finalizada') return { groupId: game.groupId, seasonId: null, warning: 'La temporada ya cerró: la partida se guardó sin temporada.' };
  const problem = associationProblem(season, game, game.createdAt);
  if (problem) return { groupId: game.groupId, seasonId: null, warning: problem };
  return { groupId: game.groupId, seasonId: game.seasonId, warning: null };
}

export function registerGroupRoutes(app, ctx) {
  const { db, now, auth, loadGames } = ctx;
  const joinLimiter = createLoginLimiter({ maxAttempts: 10, windowMs: 15 * 60 * 1000 });

  async function membership(t, groupId, userId) {
    if (!ID_RE.test(groupId ?? '')) throw notFound('El grupo no existe.');
    const row = await t.get(
      `SELECT g.*, m.role AS my_role FROM domino.groups g
       JOIN domino.group_members m ON m.group_id = g.id AND m.user_id = $2
       WHERE g.id = $1 AND g.archived_at IS NULL`,
      [groupId, userId],
    );
    // Si no es integrante, se responde como si no existiera: no se revela la existencia de grupos privados.
    if (!row) throw notFound('El grupo no existe.');
    return row;
  }
  const requireRole = (row, min) => {
    if (ROLE_RANK[row.my_role] < ROLE_RANK[min]) throw forbidden(min === 'propietario' ? 'Solo el propietario del grupo puede hacer esto.' : 'Solo el propietario o un administrador del grupo puede hacer esto.');
  };
  const groupView = (row, extra = {}) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    photo: row.photo,
    timezone: row.timezone,
    createdAt: row.created_at,
    myRole: row.my_role,
    ...extra,
  });

  // ---------------------------------------------------------------- Grupos
  app.get('/api/groups', auth, async (req, res) => {
    const rows = await db.all(
      `SELECT g.*, m.role AS my_role, (SELECT COUNT(*)::int FROM domino.group_members x WHERE x.group_id = g.id) AS members
       FROM domino.groups g JOIN domino.group_members m ON m.group_id = g.id AND m.user_id = $1
       WHERE g.archived_at IS NULL ORDER BY lower(g.name)`,
      [req.user.id],
    );
    const seasons = rows.length
      ? (await db.all('SELECT * FROM domino.seasons WHERE group_id = ANY($1::text[]) AND cancelled_at IS NULL', [rows.map((r) => r.id)])).map(seasonFromRow)
      : [];
    const at = now();
    res.json({
      groups: rows.map((r) =>
        groupView(r, {
          members: r.members,
          seasons: seasons
            .filter((s) => s.groupId === r.id)
            .map((s) => ({ id: s.id, name: s.name, status: seasonStatus(s, at), modes: s.modes, ranking: s.ranking, startsOn: s.startsOn, endsOn: s.endsOn })),
        }),
      ),
    });
  });

  app.post('/api/groups', auth, async (req, res) => {
    const name = cleanText(req.body?.name, 'El nombre del grupo', 40, true);
    const description = cleanText(req.body?.description, 'La descripción', 200);
    const timezone = req.body?.timezone ?? 'America/Santo_Domingo';
    if (!isValidTimeZone(timezone)) throw bad('Zona horaria inválida.');
    const photo = req.body?.photo ? validateImage(req.body.photo, { maxBytes: 300 * 1024, minSide: 1, maxSide: 2048, label: 'La imagen' }).dataUri : null;
    const id = newId();
    const at = now();
    await db.tx(async (t) => {
      await t.run('INSERT INTO domino.groups (id, name, description, photo, timezone, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        id,
        name,
        description,
        photo,
        timezone,
        at,
        req.user.id,
      ]);
      await t.run("INSERT INTO domino.group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'propietario', $3)", [id, req.user.id, at]);
    });
    res.status(201).json({ group: groupView({ id, name, description, photo, timezone, created_at: at, my_role: 'propietario' }) });
  });

  app.get('/api/groups/:id', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    const members = await db.all(
      `SELECT m.user_id, m.role, m.joined_at, u.username, u.photo, p.name AS player_name
       FROM domino.group_members m JOIN domino.users u ON u.id = m.user_id
       LEFT JOIN domino.players p ON p.id = u.player_id
       WHERE m.group_id = $1 ORDER BY CASE m.role WHEN 'propietario' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(u.username)`,
      [g.id],
    );
    const at = now();
    const seasons = (await db.all('SELECT * FROM domino.seasons WHERE group_id = $1 ORDER BY starts_on DESC', [g.id])).map(seasonFromRow);
    const canManage = ROLE_RANK[g.my_role] >= ROLE_RANK.admin;
    const invites = canManage
      ? (await db.all('SELECT * FROM domino.group_invites WHERE group_id = $1 ORDER BY created_at DESC LIMIT 50', [g.id])).map((i) => ({
          id: i.id,
          createdAt: i.created_at,
          expiresAt: i.expires_at,
          revokedAt: i.revoked_at,
          uses: i.uses,
          maxUses: i.max_uses,
          active: !i.revoked_at && i.expires_at > at && (i.max_uses == null || i.uses < i.max_uses),
        }))
      : [];
    res.json({
      group: groupView(g),
      members: members.map((m) => ({ userId: m.user_id, username: m.username, role: m.role, joinedAt: m.joined_at, photo: m.photo ?? null, playerName: m.player_name ?? null, me: m.user_id === req.user.id })),
      seasons: seasons.map((s) => ({ ...s, final: undefined, status: seasonStatus(s, at), champions: s.final?.champions ?? null })),
      invites,
    });
  });

  app.patch('/api/groups/:id', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    requireRole(g, 'admin');
    const next = { name: g.name, description: g.description, photo: g.photo, timezone: g.timezone };
    if (req.body.name !== undefined) next.name = cleanText(req.body.name, 'El nombre del grupo', 40, true);
    if (req.body.description !== undefined) next.description = cleanText(req.body.description, 'La descripción', 200);
    if (req.body.timezone !== undefined) {
      if (!isValidTimeZone(req.body.timezone)) throw bad('Zona horaria inválida.');
      next.timezone = req.body.timezone;
    }
    if (req.body.photo !== undefined) {
      next.photo = req.body.photo ? validateImage(req.body.photo, { maxBytes: 300 * 1024, minSide: 1, maxSide: 2048, label: 'La imagen' }).dataUri : null;
    }
    await db.run('UPDATE domino.groups SET name = $1, description = $2, photo = $3, timezone = $4 WHERE id = $5', [next.name, next.description, next.photo, next.timezone, g.id]);
    res.json({ group: groupView({ ...g, ...next }) });
  });

  // ---------------------------------------------------------------- Integrantes y roles
  const ownersCount = async (t, groupId) => (await t.get("SELECT COUNT(*)::int AS n FROM domino.group_members WHERE group_id = $1 AND role = 'propietario'", [groupId])).n;

  app.post('/api/groups/:id/members/:userId/role', auth, async (req, res) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) throw bad('Rol inválido.');
    await db.tx(async (t) => {
      const g = await membership(t, req.params.id, req.user.id);
      requireRole(g, 'propietario');
      const target = await t.get('SELECT * FROM domino.group_members WHERE group_id = $1 AND user_id = $2 FOR UPDATE', [g.id, Number(req.params.userId)]);
      if (!target) throw notFound('Esa cuenta no pertenece al grupo.');
      if (target.role === 'propietario' && role !== 'propietario' && (await ownersCount(t, g.id)) <= 1) {
        throw conflict('El grupo no puede quedar sin propietario. Nombra antes a otro propietario.');
      }
      await t.run('UPDATE domino.group_members SET role = $1 WHERE group_id = $2 AND user_id = $3', [role, g.id, target.user_id]);
    });
    res.status(204).end();
  });

  // Quitar a alguien del grupo no borra sus partidas ni resultados.
  app.delete('/api/groups/:id/members/:userId', auth, async (req, res) => {
    await db.tx(async (t) => {
      const g = await membership(t, req.params.id, req.user.id);
      const target = await t.get('SELECT * FROM domino.group_members WHERE group_id = $1 AND user_id = $2 FOR UPDATE', [g.id, Number(req.params.userId)]);
      if (!target) throw notFound('Esa cuenta no pertenece al grupo.');
      if (target.user_id === req.user.id) throw bad('Para salir del grupo usa «Salir del grupo».');
      if (g.my_role === 'admin' && target.role !== 'miembro') throw forbidden('Un administrador solo puede quitar a miembros.');
      requireRole(g, 'admin');
      if (target.role === 'propietario' && (await ownersCount(t, g.id)) <= 1) throw conflict('El grupo no puede quedar sin propietario.');
      await t.run('DELETE FROM domino.group_members WHERE group_id = $1 AND user_id = $2', [g.id, target.user_id]);
    });
    res.status(204).end();
  });

  app.post('/api/groups/:id/leave', auth, async (req, res) => {
    await db.tx(async (t) => {
      const g = await membership(t, req.params.id, req.user.id);
      if (g.my_role === 'propietario' && (await ownersCount(t, g.id)) <= 1) {
        throw conflict('Eres el único propietario: nombra a otro propietario antes de salir.');
      }
      await t.run('DELETE FROM domino.group_members WHERE group_id = $1 AND user_id = $2', [g.id, req.user.id]);
    });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- Invitaciones
  app.post('/api/groups/:id/invites', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    requireRole(g, 'admin');
    const days = Number.isInteger(req.body?.days) && req.body.days >= 1 && req.body.days <= 30 ? req.body.days : INVITE_DAYS;
    const maxUses = Number.isInteger(req.body?.maxUses) && req.body.maxUses >= 1 && req.body.maxUses <= 100 ? req.body.maxUses : null;
    const code = newInviteCode();
    const id = newId();
    const at = now();
    const expiresAt = new Date(Date.parse(now()) + days * 86400_000).toISOString();
    await db.run(
      'INSERT INTO domino.group_invites (id, group_id, code_hash, created_by, created_at, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, g.id, sha256(normalizeCode(code)), req.user.id, at, expiresAt, maxUses],
    );
    // El código solo se muestra esta vez; el servidor guarda únicamente su hash.
    res.status(201).json({ invite: { id, createdAt: at, expiresAt, uses: 0, maxUses, active: true }, code });
  });

  app.delete('/api/groups/:id/invites/:inviteId', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    requireRole(g, 'admin');
    const r = await db.run('UPDATE domino.group_invites SET revoked_at = $1 WHERE id = $2 AND group_id = $3 AND revoked_at IS NULL', [now(), req.params.inviteId, g.id]);
    if (!r.rowCount) throw notFound('La invitación no existe o ya estaba revocada.');
    res.status(204).end();
  });

  app.post('/api/groups/join', auth, async (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (joinLimiter.isBlocked(req, 'unirse')) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    if (code.length !== 8) {
      joinLimiter.fail(req, 'unirse');
      throw bad('El código tiene 8 caracteres (por ejemplo K7MQ-3XPD).');
    }
    const group = await db.tx(async (t) => {
      const inv = await t.get('SELECT * FROM domino.group_invites WHERE code_hash = $1 FOR UPDATE', [sha256(code)]);
      const at = now();
      if (!inv || inv.revoked_at || inv.expires_at <= at || (inv.max_uses != null && inv.uses >= inv.max_uses)) {
        joinLimiter.fail(req, 'unirse');
        throw notFound('El código no es válido, venció o fue revocado.');
      }
      const g = await t.get('SELECT * FROM domino.groups WHERE id = $1 AND archived_at IS NULL', [inv.group_id]);
      if (!g) throw notFound('El grupo ya no existe.');
      const already = await t.get('SELECT role FROM domino.group_members WHERE group_id = $1 AND user_id = $2', [g.id, req.user.id]);
      if (!already) {
        await t.run("INSERT INTO domino.group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'miembro', $3)", [g.id, req.user.id, at]);
        await t.run('UPDATE domino.group_invites SET uses = uses + 1 WHERE id = $1', [inv.id]);
      }
      return { ...g, my_role: already?.role ?? 'miembro' };
    });
    joinLimiter.reset(req, 'unirse');
    res.json({ group: groupView(group) });
  });

  // ---------------------------------------------------------------- Partidas del grupo
  app.get('/api/groups/:id/games', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    const rows = await db.all('SELECT id FROM domino.games WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000', [g.id]);
    const games = await annotatePlayers(db, await loadGames(db, rows.map((r) => r.id)));
    res.json({ games: games.map(({ ownerUserId: _o, ...x }) => x) });
  });

  // ---------------------------------------------------------------- Temporadas
  app.post('/api/groups/:id/seasons', auth, async (req, res) => {
    const g = await membership(db, req.params.id, req.user.id);
    requireRole(g, 'admin');
    let input;
    try {
      input = validateSeasonInput(req.body, g);
    } catch (err) {
      throw bad(err.message);
    }
    const id = newId();
    await db.run(
      `INSERT INTO domino.seasons (id, group_id, name, starts_on, ends_on, timezone, modes_json, ranking, rules_json, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, g.id, input.name, input.startsOn, input.endsOn, input.timezone, JSON.stringify(input.modes), input.ranking, JSON.stringify(input.rules), now(), req.user.id],
    );
    const season = seasonFromRow(await db.get('SELECT * FROM domino.seasons WHERE id = $1', [id]));
    res.status(201).json({ season: { ...season, status: seasonStatus(season, now()) } });
  });

  async function seasonForMember(t, seasonId, userId) {
    if (!ID_RE.test(seasonId ?? '')) throw notFound('La temporada no existe.');
    const row = await t.get('SELECT * FROM domino.seasons WHERE id = $1', [seasonId]);
    if (!row) throw notFound('La temporada no existe.');
    const g = await membership(t, row.group_id, userId);
    return { season: seasonFromRow(row), group: g };
  }

  /** Clasificación en vivo desde las partidas (única fuente de verdad). */
  async function standingsOf(t, season) {
    const rows = await t.all('SELECT id FROM domino.games WHERE season_id = $1 AND deleted_at IS NULL', [season.id]);
    const games = await annotatePlayers(t, await loadGames(t, rows.map((r) => r.id)));
    return { standings: computeStandings(season, games, sidePlayersOf), games };
  }

  /**
   * Cierre persistente e idempotente: si la temporada ya terminó, guarda (o actualiza, si una
   * corrección autorizada cambió algo) el resultado definitivo con el historial de revisiones.
   */
  async function finalizeIfDue(t, season) {
    if (seasonStatus(season, now()) !== 'finalizada') return season;
    await t.get('SELECT id FROM domino.seasons WHERE id = $1 FOR UPDATE', [season.id]);
    const fresh = seasonFromRow(await t.get('SELECT * FROM domino.seasons WHERE id = $1', [season.id]));
    const { standings } = await standingsOf(t, fresh);
    const snapshot = { rows: standings.rows, champions: standings.champions, games: standings.games };
    const prev = fresh.final;
    const same = prev && JSON.stringify({ rows: prev.rows, champions: prev.champions, games: prev.games }) === JSON.stringify(snapshot);
    if (same) return fresh;
    const at = now();
    const revisions = [...(prev?.revisions ?? []), { at, reason: prev ? 'Recalculada por una corrección de resultados' : 'Cierre de la temporada', champions: snapshot.champions }];
    const final = { ...snapshot, revisions };
    await t.run('UPDATE domino.seasons SET final_json = $1, finalized_at = COALESCE(finalized_at, $2) WHERE id = $3', [JSON.stringify(final), at, season.id]);
    return { ...fresh, final, finalizedAt: fresh.finalizedAt ?? at };
  }

  app.get('/api/seasons/:id', auth, async (req, res) => {
    const { season: s0, group } = await seasonForMember(db, req.params.id, req.user.id);
    const season = await db.tx((t) => finalizeIfDue(t, s0));
    const { standings, games } = await standingsOf(db, season);
    res.json({
      season: { ...season, status: seasonStatus(season, now()) },
      group: { id: group.id, name: group.name, myRole: group.my_role },
      standings,
      games: games.map(({ ownerUserId: _o, ...x }) => x),
    });
  });

  app.patch('/api/seasons/:id', auth, async (req, res) => {
    const out = await db.tx(async (t) => {
      const { season, group } = await seasonForMember(t, req.params.id, req.user.id);
      requireRole(group, 'admin');
      const status = seasonStatus(season, now());
      if (req.body?.cancel === true) {
        if (status === 'finalizada') throw conflict('La temporada ya terminó; no se puede cancelar.');
        await t.run('UPDATE domino.seasons SET cancelled_at = $1 WHERE id = $2', [now(), season.id]);
        return { ...season, cancelledAt: now() };
      }
      // Las reglas, fechas y modalidades solo se pueden cambiar antes de empezar.
      const changesRules = ['startsOn', 'endsOn', 'timezone', 'modes', 'ranking', 'rules'].some((k) => req.body?.[k] !== undefined);
      if (changesRules && status !== 'programada') throw conflict('La temporada ya empezó: sus reglas y fechas no se pueden cambiar.');
      let input;
      try {
        input = validateSeasonInput({ ...season, ...req.body }, group);
      } catch (err) {
        throw bad(err.message);
      }
      await t.run(
        'UPDATE domino.seasons SET name = $1, starts_on = $2, ends_on = $3, timezone = $4, modes_json = $5, ranking = $6, rules_json = $7 WHERE id = $8',
        [input.name, input.startsOn, input.endsOn, input.timezone, JSON.stringify(input.modes), input.ranking, JSON.stringify(input.rules), season.id],
      );
      return { ...season, ...input };
    });
    res.json({ season: { ...out, status: seasonStatus(out, now()) } });
  });

  /** Cierre diario (Vercel Cron). Protegido con CRON_SECRET; idempotente. */
  app.get('/api/cron/seasons', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'No autorizado.' });
    const rows = await db.all('SELECT * FROM domino.seasons WHERE cancelled_at IS NULL');
    let finalized = 0;
    for (const r of rows) {
      const s = seasonFromRow(r);
      if (seasonStatus(s, now()) !== 'finalizada') continue;
      const before = s.final ? JSON.stringify(s.final.champions) : null;
      const after = await db.tx((t) => finalizeIfDue(t, s));
      if (!before || JSON.stringify(after.final?.champions) !== before) finalized += 1;
    }
    res.json({ ok: true, checked: rows.length, updated: finalized });
  });

  // ---------------------------------------------------------------- Pantalla grande (espectadores)
  async function ownGame(t, req) {
    if (!ID_RE.test(req.params.id ?? '')) throw notFound('La partida no existe.');
    const row = await t.get('SELECT id, source_user_id, deleted_at FROM domino.games WHERE id = $1', [req.params.id]);
    if (!row || row.deleted_at) throw notFound('La partida todavía no está en el servidor. Espera a que se sincronice.');
    if (row.source_user_id !== req.user.id && !isAdminRole(req.user.role)) throw forbidden('Solo quien registra la partida puede crear la pantalla grande.');
    return row;
  }

  app.post('/api/games/:id/spectator', auth, async (req, res) => {
    const game = await ownGame(db, req);
    // Token aleatorio de 192 bits: no se puede adivinar; el servidor guarda solo su hash.
    const token = randomBytes(24).toString('base64url');
    await db.run('INSERT INTO domino.spectator_links (token_hash, game_id, created_by, created_at) VALUES ($1, $2, $3, $4)', [sha256(token), game.id, req.user.id, now()]);
    res.status(201).json({ token });
  });

  app.delete('/api/games/:id/spectator', auth, async (req, res) => {
    const game = await ownGame(db, req);
    const r = await db.run('UPDATE domino.spectator_links SET revoked_at = $1 WHERE game_id = $2 AND revoked_at IS NULL', [now(), game.id]);
    res.json({ revoked: r.rowCount });
  });

  // Público, de solo lectura y limitado a esa partida: sin grupo, cuentas, fotos ni identificadores.
  app.get('/api/spectate/:token', async (req, res) => {
    const token = String(req.params.token ?? '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('El enlace no es válido.');
    const link = await db.get('SELECT * FROM domino.spectator_links WHERE token_hash = $1', [sha256(token)]);
    if (!link || link.revoked_at) throw notFound('Este enlace de pantalla grande fue desactivado o no existe.');
    const [game] = await loadGames(db, [link.game_id]);
    if (!game || game.deletedAt) throw notFound('La partida ya no está disponible.');
    const last = game.hands[game.hands.length - 1] ?? null;
    res.json({
      revision: game.revision,
      updatedAt: game.updatedAt,
      status: game.status,
      mode: game.mode,
      target: game.target,
      winnerSideId: game.winnerSideId,
      sides: game.sides.map((s) => ({
        id: s.id,
        name: s.name,
        members: s.participantIds.map((pid) => game.participants.find((p) => p.id === pid)?.name ?? '').filter(Boolean),
        total: game.totals[s.id] ?? 0,
      })),
      lastHand: last ? { sideId: last.sideId, points: last.points, at: last.editedAt ?? last.createdAt, number: game.hands.length } : null,
      serverTime: now(),
    });
  });
}
