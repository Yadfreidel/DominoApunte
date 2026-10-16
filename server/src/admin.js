// Rutas del panel de administración (/api/admin). El acceso (propietario o administrador) se
// verifica en el servidor en cada petición antes de llegar aquí (ver app.js).
import { hashPassword, publicUser, validatePasswordStrength } from './auth.js';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_BRANDING,
  DEFAULT_SETTINGS,
  getAppearance,
  getBranding,
  getSettings,
  saveAppearance,
  saveBranding,
  saveSettings,
} from './db.js';
import { isNonNegativeInt, MAX_HAND_POINTS, MAX_TARGET } from './domain.js';
import { bad, cleanEmail, cleanName, HttpError, ID_RE, MODES, notFound, requireReason, STATUSES } from './http.js';
import { drawBracket, newId, resolveBracket, startedEntrantIds } from './tournament.js';
import { describeImage, toCsv, validateAppearance, validateImage } from './validation.js';

const conflict = (message) => new HttpError(409, message);
/** Cuenta para la auditoría: sin la imagen de la foto (solo si tiene una). */
const auditUser = (u) => ({ ...publicUser(u), photo: u.photo ? 'foto' : null });
const PAGE_MAX = 100;
const CONFIRM_WORD = 'ELIMINAR';
const PHOTO_MAX_BYTES = 200 * 1024;
const LOGO_MAX_BYTES = 1024 * 1024;

/** Clave para detectar perfiles duplicados: sin tildes, mayúsculas ni signos. */
export const duplicateKey = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

function paging(query) {
  const size = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(query.size, 10) || 25));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { size, page, offset: (page - 1) * size };
}

const likeParam = (text) => `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Constructor de cláusulas WHERE con parámetros numerados. */
function whereBuilder() {
  const where = [];
  const params = [];
  return {
    add(sql, ...values) {
      let out = sql;
      for (const v of values) {
        params.push(v);
        out = out.replace('?', `$${params.length}`);
      }
      where.push(out);
    },
    param(value) {
      params.push(value);
      return `$${params.length}`;
    },
    sql: () => (where.length ? `WHERE ${where.join(' AND ')}` : ''),
    params,
  };
}

function playerRow(r) {
  const decided = r.wins + r.losses;
  return {
    id: r.id,
    name: r.name,
    active: !!r.active,
    createdAt: r.created_at,
    photo: r.photo ?? null,
    deletedAt: r.deleted_at ?? null,
    played: r.played,
    wins: r.wins,
    losses: r.losses,
    pending: r.pending,
    cancelled: r.cancelled,
    points: r.points,
    winRate: decided ? Math.round((r.wins / decided) * 1000) / 10 : 0,
    account: r.account_id ? { id: r.account_id, username: r.account_username, active: !!r.account_active } : null,
  };
}

// Estadísticas oficiales: no cuentan partidas de prueba ni las que están en la papelera.
const PLAYER_STATS_SQL = `
  SELECT p.id, p.name, p.active, p.created_at, p.photo, p.deleted_at,
    u.id AS account_id, u.username AS account_username, u.active AS account_active,
    COUNT(g.id)::int AS played,
    COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id = gp.side_id THEN 1 ELSE 0 END), 0)::int AS wins,
    COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id <> gp.side_id THEN 1 ELSE 0 END), 0)::int AS losses,
    COALESCE(SUM(CASE WHEN g.status = 'pendiente' THEN 1 ELSE 0 END), 0)::int AS pending,
    COALESCE(SUM(CASE WHEN g.status = 'cancelada' THEN 1 ELSE 0 END), 0)::int AS cancelled,
    COALESCE(SUM(CASE WHEN g.id IS NOT NULL THEN hp.pts ELSE 0 END), 0)::int AS points
  FROM domino.players p
  LEFT JOIN domino.users u ON u.player_id = p.id
  LEFT JOIN domino.game_players gp ON gp.player_id = p.id
  LEFT JOIN domino.games g ON g.id = gp.game_id AND g.practice = 0 AND g.deleted_at IS NULL
  LEFT JOIN (SELECT game_id, side_id, SUM(points) AS pts FROM domino.hands GROUP BY game_id, side_id) hp
    ON hp.game_id = gp.game_id AND hp.side_id = gp.side_id`;
const PLAYER_GROUP = 'GROUP BY p.id, u.id';

export function registerAdminRoutes(admin, ctx) {
  const { db, now, toId, userById, playerByName, playerById, logCorrection, loadGames, loadGame, requireGame } = ctx;
  const { rowToTournament, saveAdminChange, withLockedGame } = ctx;
  const isOwner = (req) => req.user.role === 'propietario';

  // ================================================================ Resumen
  admin.get('/summary', async (req, res) => {
    const c = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM domino.players WHERE deleted_at IS NULL)::int AS players,
        (SELECT COUNT(*) FROM domino.players WHERE active = 1 AND deleted_at IS NULL)::int AS active_players,
        (SELECT COUNT(*) FROM domino.games WHERE deleted_at IS NULL)::int AS games,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'pendiente' AND deleted_at IS NULL)::int AS active,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'terminada' AND deleted_at IS NULL)::int AS finished,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'cancelada' AND deleted_at IS NULL)::int AS cancelled,
        (SELECT COUNT(*) FROM domino.games WHERE practice = 1 AND deleted_at IS NULL)::int AS practice,
        (SELECT COUNT(*) FROM domino.games WHERE deleted_at IS NOT NULL)::int AS trashed_games,
        (SELECT COUNT(*) FROM domino.players WHERE deleted_at IS NOT NULL)::int AS trashed_players,
        (SELECT COUNT(*) FROM domino.corrections)::int AS corrections`);
    // Torneos en curso: activos o en pausa y todavía sin campeón (derivado de sus partidas).
    const tours = (await db.all("SELECT * FROM domino.tournaments WHERE status IN ('activo', 'pausado')")).map(rowToTournament);
    const tourGames = await gamesOfTournaments(db, tours.map((t) => t.id));
    const activeTournaments = tours.filter((t) => !resolveBracket(t, tourGames).champion).length;
    const recent = await db.all('SELECT id FROM domino.games WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5');
    const activity = await db.all('SELECT * FROM domino.corrections ORDER BY id DESC LIMIT 8');
    res.json({
      players: c.players,
      activePlayers: c.active_players,
      games: c.games,
      active: c.active,
      finished: c.finished,
      cancelled: c.cancelled,
      practice: c.practice,
      trash: c.trashed_games + c.trashed_players,
      corrections: c.corrections,
      activeTournaments,
      recentGames: await loadGames(db, recent.map((r) => r.id)),
      recentActivity: activity.map(auditRow),
    });
  });

  async function gamesOfTournaments(t, ids) {
    if (!ids.length) return [];
    const rows = await t.all('SELECT id FROM domino.games WHERE tournament_id = ANY($1::text[]) AND deleted_at IS NULL', [ids]);
    return loadGames(t, rows.map((r) => r.id));
  }

  // ================================================================ Jugadores
  admin.get('/players', async (req, res) => {
    const { size, page, offset } = paging(req.query);
    const w = whereBuilder();
    const status = req.query.status;
    if (status === 'papelera') w.add('p.deleted_at IS NOT NULL');
    else w.add('p.deleted_at IS NULL');
    if (status === 'activos') w.add('p.active = 1');
    if (status === 'inactivos') w.add('p.active = 0');
    if (typeof req.query.search === 'string' && req.query.search.trim()) w.add("p.name ILIKE ? ESCAPE '\\'", likeParam(req.query.search));
    const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM domino.players p ${w.sql()}`, w.params);
    const rows = await db.all(
      `${PLAYER_STATS_SQL} ${w.sql()} ${PLAYER_GROUP} ORDER BY lower(p.name) LIMIT ${size} OFFSET ${offset}`,
      w.params,
    );
    res.json({ players: rows.map(playerRow), total, page, size });
  });

  // Posibles duplicados: perfiles cuyo nombre coincide sin tildes, mayúsculas ni signos.
  admin.get('/players/duplicates', async (req, res) => {
    const rows = await db.all(`${PLAYER_STATS_SQL} WHERE p.deleted_at IS NULL ${PLAYER_GROUP} ORDER BY p.id`);
    const groups = new Map();
    for (const r of rows) {
      const key = duplicateKey(r.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(playerRow(r));
    }
    res.json({ groups: [...groups.values()].filter((g) => g.length > 1) });
  });

  admin.get('/players/:id', async (req, res) => {
    const id = toId(req.params.id);
    const row = id && (await db.get(`${PLAYER_STATS_SQL} WHERE p.id = $1 ${PLAYER_GROUP}`, [id]));
    if (!row) throw notFound('El jugador no existe.');
    const ids = await db.all(
      `SELECT g.id FROM domino.game_players gp JOIN domino.games g ON g.id = gp.game_id
       WHERE gp.player_id = $1 AND g.deleted_at IS NULL ORDER BY g.created_at DESC LIMIT 100`,
      [row.id],
    );
    const aliases = await db.all('SELECT alias_key FROM domino.player_aliases WHERE player_id = $1 ORDER BY alias_key', [row.id]);
    res.json({ player: playerRow(row), games: await loadGames(db, ids.map((r) => r.id)), aliases: aliases.map((a) => a.alias_key) });
  });

  admin.post('/players', async (req, res) => {
    const name = cleanName(req.body?.name);
    const photo = req.body?.photo ? validateImage(req.body.photo, { maxBytes: PHOTO_MAX_BYTES, label: 'La foto' }) : null;
    if (await playerByName(db, name)) throw conflict('Ya existe un jugador con ese nombre.');
    const alias = await db.get('SELECT player_id FROM domino.player_aliases WHERE alias_key = lower($1)', [name]);
    if (alias) throw conflict('Ese nombre pertenece a otro perfil (nombre anterior o fusionado).');
    const id = await db.tx(async (t) => {
      const created = await t.get(
        'INSERT INTO domino.players (name, active, created_at, photo) VALUES ($1, 1, $2, $3) RETURNING id',
        [name, now(), photo?.dataUri ?? null],
      );
      await logCorrection(t, req, {
        entity: 'jugador',
        entityId: created.id,
        action: 'crear',
        reason: 'Alta de jugador',
        after: { name, photo: describeImage(photo) },
      });
      return created.id;
    });
    res.status(201).json({ player: { id, name, active: true } });
  });

  /** Reemplaza nombres en las partidas de un jugador (participantes y, en individual, el lado). */
  async function renameInGames(t, playerId, oldKeys, newName, playerIdForClient = undefined) {
    const games = await t.all(
      `SELECT g.* FROM domino.game_players gp JOIN domino.games g ON g.id = gp.game_id
       WHERE gp.player_id = $1 FOR UPDATE OF g`,
      [playerId],
    );
    for (const row of games) {
      const participants = JSON.parse(row.participants_json).map((p) =>
        oldKeys.has(p.name.toLowerCase())
          ? { ...p, name: newName, ...(playerIdForClient ? { playerId: playerIdForClient } : {}) }
          : p,
      );
      const sides = JSON.parse(row.sides_json);
      const renamedSides = row.mode === 'individual' ? sides.map((s) => (oldKeys.has(s.name.toLowerCase()) ? { ...s, name: newName } : s)) : sides;
      await t.run(
        `UPDATE domino.games SET participants_json = $1, sides_json = $2, revision = revision + 1,
                                 admin_revision = revision + 1, updated_at = $3 WHERE id = $4`,
        [JSON.stringify(participants), JSON.stringify(renamedSides), now(), row.id],
      );
    }
    return games.length;
  }

  /** Reemplaza nombres en los torneos que incluyen a alguno de `oldKeys`. */
  async function renameInTournaments(t, oldKeys, newName, playerIdForClient = undefined) {
    const rows = await t.all('SELECT * FROM domino.tournaments FOR UPDATE');
    let changed = 0;
    for (const row of rows) {
      const data = JSON.parse(row.data_json);
      let touched = false;
      data.entrants = data.entrants.map((e) => {
        const players = e.players.map((p) => {
          if (!oldKeys.has(p.name.toLowerCase())) return p;
          touched = true;
          return { playerId: playerIdForClient ?? p.playerId, name: newName };
        });
        const name = row.mode === 'individual' && oldKeys.has(e.name.toLowerCase()) ? newName : e.name;
        return { ...e, name, players };
      });
      if (!touched) continue;
      changed++;
      await t.run(
        'UPDATE domino.tournaments SET data_json = $1, revision = revision + 1, admin_revision = revision + 1, updated_at = $2 WHERE id = $3',
        [JSON.stringify(data), now(), row.id],
      );
    }
    return changed;
  }

  admin.patch('/players/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    const player = id && (await playerById(db, id));
    if (!player) throw notFound('El jugador no existe.');
    if (player.deleted_at) throw conflict('El jugador está en la papelera. Restáuralo antes de editarlo.');
    const before = { name: player.name, active: !!player.active, photo: player.photo ? 'foto' : null };
    const after = { ...before };
    let photo = player.photo;
    if (req.body.name !== undefined) after.name = cleanName(req.body.name);
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') throw bad('Estado de jugador inválido.');
      after.active = req.body.active;
    }
    if (req.body.photo !== undefined) {
      const img = req.body.photo === null ? null : validateImage(req.body.photo, { maxBytes: PHOTO_MAX_BYTES, label: 'La foto' });
      photo = img?.dataUri ?? null;
      after.photo = describeImage(img);
    }
    const clash = await playerByName(db, after.name);
    if (clash && clash.id !== player.id) throw conflict('Ya existe un jugador con ese nombre.');
    const alias = await db.get('SELECT player_id FROM domino.player_aliases WHERE alias_key = lower($1)', [after.name]);
    if (alias && alias.player_id !== player.id) throw conflict('Ese nombre pertenece a otro perfil (nombre anterior o fusionado).');
    await db.tx(async (t) => {
      await t.run('UPDATE domino.players SET name = $1, active = $2, photo = $3 WHERE id = $4', [after.name, after.active ? 1 : 0, photo, player.id]);
      if (after.name !== player.name) {
        // El nombre anterior queda como alias: una partida antigua que llegue no recrea el perfil.
        await t.run('DELETE FROM domino.player_aliases WHERE alias_key = lower($1)', [after.name]);
        if (player.name.toLowerCase() !== after.name.toLowerCase()) {
          await t.run(
            'INSERT INTO domino.player_aliases (alias_key, player_id, created_at) VALUES (lower($1), $2, $3) ON CONFLICT (alias_key) DO UPDATE SET player_id = excluded.player_id',
            [player.name, player.id, now()],
          );
        }
        const keys = new Set([player.name.toLowerCase()]);
        await renameInGames(t, player.id, keys, after.name);
        await renameInTournaments(t, keys, after.name);
      }
      await logCorrection(t, req, { entity: 'jugador', entityId: player.id, action: 'editar', reason, before, after });
    });
    res.json({ player: { id: player.id, name: after.name, active: after.active } });
  });

  // Eliminar un perfil lo envía a la papelera: su historial y estadísticas se conservan.
  admin.delete('/players/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    const player = id && (await playerById(db, id));
    if (!player) throw notFound('El jugador no existe.');
    if (player.deleted_at) throw conflict('El jugador ya está en la papelera.');
    await db.tx(async (t) => {
      await t.run('UPDATE domino.players SET deleted_at = $1, deleted_by = $2, active = 0 WHERE id = $3', [now(), req.user.username, player.id]);
      await logCorrection(t, req, {
        entity: 'jugador',
        entityId: player.id,
        action: 'papelera',
        reason,
        before: { name: player.name, active: !!player.active },
        after: { deleted: true },
      });
    });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- Fusión de duplicados
  async function mergePlan(t, body) {
    const primaryId = toId(body?.primaryId);
    const duplicateIds = Array.isArray(body?.duplicateIds) ? [...new Set(body.duplicateIds.map(toId))] : [];
    if (!primaryId || !duplicateIds.length || duplicateIds.some((x) => !x)) throw bad('Elige el perfil principal y al menos un duplicado.');
    if (duplicateIds.includes(primaryId)) throw bad('El perfil principal no puede ser también un duplicado.');
    if (duplicateIds.length > 10) throw bad('Fusiona como máximo 10 perfiles a la vez.');
    const ids = [primaryId, ...duplicateIds];
    const players = await t.all('SELECT * FROM domino.players WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
    if (players.length !== ids.length) throw notFound('Alguno de los perfiles no existe.');
    const primary = players.find((p) => p.id === primaryId);
    const duplicates = players.filter((p) => p.id !== primaryId);
    if (primary.deleted_at) throw conflict('El perfil principal está en la papelera. Restáuralo primero.');
    const aliasRows = await t.all('SELECT alias_key, player_id FROM domino.player_aliases WHERE player_id = ANY($1::int[])', [ids]);
    const keysOf = (p) => new Set([p.name.toLowerCase(), ...aliasRows.filter((a) => a.player_id === p.id).map((a) => a.alias_key)]);
    const dupKeys = new Set(duplicates.flatMap((d) => [...keysOf(d)]));
    const primaryKeys = keysOf(primary);

    const conflicts = [];
    // Una partida con dos de estos perfiles quedaría con el mismo jugador dos veces.
    const shared = await t.all(
      `SELECT gp.game_id, COUNT(DISTINCT gp.player_id)::int AS n FROM domino.game_players gp
       WHERE gp.player_id = ANY($1::int[]) GROUP BY gp.game_id HAVING COUNT(DISTINCT gp.player_id) > 1`,
      [ids],
    );
    for (const s of shared) conflicts.push({ type: 'partida', id: s.game_id, message: `La partida ${s.game_id} tiene a ${s.n} de estos perfiles como jugadores distintos.` });
    // Un torneo con dos de estos perfiles quedaría con un enfrentamiento inválido.
    const allKeys = [...primaryKeys, ...dupKeys];
    const tours = (await t.all('SELECT * FROM domino.tournaments')).map(rowToTournament);
    const affectedTournaments = [];
    for (const tour of tours) {
      const present = new Set();
      for (const e of tour.entrants) {
        for (const p of e.players) {
          const k = p.name.toLowerCase();
          if (!allKeys.includes(k)) continue;
          present.add(primaryKeys.has(k) ? primary.id : duplicates.find((d) => keysOf(d).has(k)).id);
        }
      }
      if (present.size > 1) conflicts.push({ type: 'torneo', id: tour.id, message: `El torneo "${tour.name}" incluye a ${present.size} de estos perfiles.` });
      else if (present.size === 1 && !present.has(primary.id)) affectedTournaments.push({ id: tour.id, name: tour.name });
    }
    const gameRows = await t.all(
      `SELECT DISTINCT gp.game_id FROM domino.game_players gp WHERE gp.player_id = ANY($1::int[])`,
      [duplicateIds],
    );
    const accounts = await t.all('SELECT id, username, player_id FROM domino.users WHERE player_id = ANY($1::int[])', [ids]);
    if (accounts.filter((a) => a.player_id).length > 1) {
      conflicts.push({ type: 'cuenta', id: null, message: 'Más de uno de estos perfiles tiene una cuenta de acceso vinculada. Desvincula una antes de fusionar.' });
    }
    // playerId que usan las apps para el perfil principal (para que sus estadísticas queden unidas).
    let clientId = null;
    const sample = await t.all(
      `SELECT g.participants_json FROM domino.game_players gp JOIN domino.games g ON g.id = gp.game_id
       WHERE gp.player_id = ANY($1::int[]) ORDER BY (gp.player_id = $2) DESC, g.created_at LIMIT 50`,
      [ids, primary.id],
    );
    for (const row of sample) {
      const found = JSON.parse(row.participants_json).find((p) => p.playerId && (primaryKeys.has(p.name.toLowerCase()) || dupKeys.has(p.name.toLowerCase())));
      if (found) {
        clientId = found.playerId;
        break;
      }
    }
    return { primary, duplicates, dupKeys, conflicts, gameIds: gameRows.map((r) => r.game_id), affectedTournaments, accounts, clientId };
  }

  const planSummary = (p) => ({
    primary: { id: p.primary.id, name: p.primary.name },
    duplicates: p.duplicates.map((d) => ({ id: d.id, name: d.name, inTrash: !!d.deleted_at })),
    games: p.gameIds.length,
    gameIds: p.gameIds.slice(0, 50),
    tournaments: p.affectedTournaments,
    conflicts: p.conflicts,
    canMerge: p.conflicts.length === 0,
  });

  admin.post('/players/merge/preview', async (req, res) => {
    res.json(planSummary(await mergePlan(db, req.body)));
  });

  // Fusión atómica: si algo falla, no se aplica nada.
  admin.post('/players/merge', async (req, res) => {
    const reason = requireReason(req.body);
    const result = await db.tx(async (t) => {
      await t.run('SELECT id FROM domino.players WHERE id = ANY($1::int[]) FOR UPDATE', [[toId(req.body?.primaryId), ...(req.body?.duplicateIds ?? []).map(toId)].filter(Boolean)]);
      const plan = await mergePlan(t, req.body);
      if (plan.conflicts.length) throw conflict(`No se puede fusionar: ${plan.conflicts.map((c) => c.message).join(' ')}`);
      const { primary, duplicates, dupKeys, clientId } = plan;
      for (const d of duplicates) {
        await renameInGames(t, d.id, dupKeys, primary.name, clientId ?? undefined);
      }
      await renameInTournaments(t, dupKeys, primary.name, clientId ?? undefined);
      const dupIds = duplicates.map((d) => d.id);
      await t.run('UPDATE domino.game_players SET player_id = $1 WHERE player_id = ANY($2::int[])', [primary.id, dupIds]);
      await t.run('UPDATE domino.player_aliases SET player_id = $1 WHERE player_id = ANY($2::int[])', [primary.id, dupIds]);
      await t.run('UPDATE domino.users SET player_id = $1 WHERE player_id = ANY($2::int[])', [primary.id, dupIds]);
      if (!primary.photo) {
        const withPhoto = duplicates.find((d) => d.photo);
        if (withPhoto) await t.run('UPDATE domino.players SET photo = $1 WHERE id = $2', [withPhoto.photo, primary.id]);
      }
      await t.run('DELETE FROM domino.players WHERE id = ANY($1::int[])', [dupIds]);
      for (const key of dupKeys) {
        if (key === primary.name.toLowerCase()) continue;
        await t.run(
          'INSERT INTO domino.player_aliases (alias_key, player_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (alias_key) DO UPDATE SET player_id = excluded.player_id',
          [key, primary.id, now()],
        );
      }
      await logCorrection(t, req, {
        entity: 'jugador',
        entityId: primary.id,
        action: 'fusionar',
        reason,
        before: { primary: { id: primary.id, name: primary.name }, duplicates: duplicates.map((d) => ({ id: d.id, name: d.name })) },
        after: { id: primary.id, name: primary.name, games: plan.gameIds.length, tournaments: plan.affectedTournaments.length },
      });
      return planSummary(plan);
    });
    res.json(result);
  });

  // ================================================================ Partidas
  function gameFilters(query, { includeDeleted = false } = {}) {
    const w = whereBuilder();
    if (!includeDeleted) w.add('g.deleted_at IS NULL');
    if (STATUSES.includes(query.status)) w.add('g.status = ?', query.status);
    if (query.type === 'prueba') w.add('g.practice = 1');
    if (query.type === 'reales') w.add('g.practice = 0');
    if (typeof query.tournament === 'string' && ID_RE.test(query.tournament)) w.add('g.tournament_id = ?', query.tournament);
    if (typeof query.player === 'string' && query.player.trim()) {
      w.add(
        `EXISTS (SELECT 1 FROM domino.game_players gp JOIN domino.players p ON p.id = gp.player_id
                 WHERE gp.game_id = g.id AND p.name ILIKE ? ESCAPE '\\')`,
        likeParam(query.player),
      );
    }
    if (isDay(query.from)) w.add('substr(g.created_at, 1, 10) >= ?', query.from);
    if (isDay(query.to)) w.add('substr(g.created_at, 1, 10) <= ?', query.to);
    return w;
  }

  admin.get('/games', async (req, res) => {
    const { size, page, offset } = paging(req.query);
    const w = gameFilters(req.query);
    const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM domino.games g ${w.sql()}`, w.params);
    const rows = await db.all(`SELECT g.id FROM domino.games g ${w.sql()} ORDER BY g.created_at DESC LIMIT ${size} OFFSET ${offset}`, w.params);
    res.json({ games: await loadGames(db, rows.map((r) => r.id)), total, page, size });
  });

  admin.get('/games/:id', async (req, res) => {
    const game = await requireGame(db, req.params.id);
    const corrections = (await db.all('SELECT * FROM domino.corrections WHERE game_id = $1 ORDER BY id DESC', [game.id])).map(auditRow);
    let tournament = null;
    if (game.tournamentId) {
      const row = await db.get('SELECT id, name, status FROM domino.tournaments WHERE id = $1', [game.tournamentId]);
      tournament = row ?? null;
    }
    res.json({ game, corrections, tournament });
  });

  admin.patch('/games/:id/hands/:handId', async (req, res) => {
    const reason = requireReason(req.body);
    const points = req.body?.points;
    if (!isNonNegativeInt(points, MAX_HAND_POINTS)) {
      throw bad(`Los puntos deben ser un número entero entre 0 y ${MAX_HAND_POINTS}.`);
    }
    const id = await withLockedGame(req.params.id, async (t, game) => {
      const hand = game.hands.find((h) => h.id === req.params.handId);
      if (!hand) throw notFound('La mano no existe.');
      const result = await saveAdminChange(t, {
        ...game,
        hands: game.hands.map((h) => (h.id === hand.id ? { ...h, points, editedAt: now() } : h)),
      });
      await logCorrection(t, req, {
        entity: 'mano',
        entityId: hand.id,
        gameId: game.id,
        action: 'editar',
        reason,
        before: { points: hand.points, status: game.status, winnerSideId: game.winnerSideId },
        after: { points, status: result.status, winnerSideId: result.winnerSideId },
      });
      return game.id;
    });
    res.json({ game: await loadGame(db, id) });
  });

  admin.delete('/games/:id/hands/:handId', async (req, res) => {
    const reason = requireReason(req.body);
    const id = await withLockedGame(req.params.id, async (t, game) => {
      const hand = game.hands.find((h) => h.id === req.params.handId);
      if (!hand) throw notFound('La mano no existe.');
      const result = await saveAdminChange(t, { ...game, hands: game.hands.filter((h) => h.id !== hand.id) });
      await logCorrection(t, req, {
        entity: 'mano',
        entityId: hand.id,
        gameId: game.id,
        action: 'eliminar',
        reason,
        before: { sideId: hand.sideId, points: hand.points, status: game.status },
        after: { status: result.status, winnerSideId: result.winnerSideId },
      });
      return game.id;
    });
    res.json({ game: await loadGame(db, id) });
  });

  // Cancelar / reabrir y marcar o desmarcar como partida de prueba.
  admin.patch('/games/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const { status, practice } = req.body ?? {};
    if (status === undefined && practice === undefined) throw bad('No hay cambios.');
    if (status !== undefined && status !== 'cancelada' && status !== 'pendiente') throw bad('Solo puedes cancelar una partida o reabrirla.');
    if (practice !== undefined && typeof practice !== 'boolean') throw bad('Valor de prueba inválido.');
    const id = await withLockedGame(req.params.id, async (t, game) => {
      const next = { ...game };
      const before = {};
      const after = {};
      if (status !== undefined) {
        if (status === game.status) throw bad('La partida ya tiene ese estado.');
        next.status = status;
        before.status = game.status;
      }
      if (practice !== undefined) {
        if (practice === game.practice) throw bad(practice ? 'La partida ya está marcada como prueba.' : 'La partida ya es oficial.');
        next.practice = practice;
        before.practice = game.practice;
        after.practice = practice;
      }
      // Reabrir recalcula el estado real (si alguien ya alcanzó la meta, vuelve a quedar terminada).
      const result = await saveAdminChange(t, next);
      if (status !== undefined) after.status = result.status;
      await logCorrection(t, req, {
        entity: 'partida',
        entityId: game.id,
        gameId: game.id,
        action: status === 'cancelada' ? 'cancelar' : status === 'pendiente' ? 'reabrir' : practice ? 'marcar_prueba' : 'marcar_oficial',
        reason,
        before,
        after,
      });
      return game.id;
    });
    res.json({ game: await loadGame(db, id) });
  });

  /** Envía una partida a la papelera (deja de contar; los dispositivos la retiran al sincronizar). */
  async function trashGame(t, req, game, reason) {
    await t.run('UPDATE domino.games SET deleted_at = $1, deleted_by = $2 WHERE id = $3', [now(), req.user.username, game.id]);
    await logCorrection(t, req, {
      entity: 'partida',
      entityId: game.id,
      gameId: game.id,
      action: 'papelera',
      reason,
      before: { status: game.status, practice: game.practice },
      after: { deleted: true },
    });
  }

  admin.delete('/games/:id', async (req, res) => {
    const reason = requireReason(req.body);
    await withLockedGame(req.params.id, (t, game) => trashGame(t, req, game, reason));
    res.status(204).end();
  });

  // ================================================================ Pruebas
  admin.get('/tests', async (req, res) => {
    const rows = await db.all('SELECT id FROM domino.games WHERE practice = 1 AND deleted_at IS NULL ORDER BY created_at DESC');
    res.json({ total: rows.length, games: await loadGames(db, rows.slice(0, 50).map((r) => r.id)) });
  });

  // Limpia (envía a la papelera) todas las partidas de prueba. Las partidas reales no se tocan.
  admin.post('/tests/cleanup', async (req, res) => {
    const reason = requireReason(req.body);
    if (req.body?.confirm !== true) throw bad('Confirma la limpieza de partidas de prueba.');
    const rows = await db.all('SELECT id FROM domino.games WHERE practice = 1 AND deleted_at IS NULL');
    let moved = 0;
    const skipped = [];
    for (const { id } of rows) {
      try {
        await withLockedGame(id, async (t, game) => {
          if (!game.practice) return; // cambió mientras tanto
          await trashGame(t, req, game, reason);
          moved++;
        });
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) skipped.push({ id, error: err.message });
        else throw err;
      }
    }
    res.json({ moved, skipped });
  });

  // ================================================================ Papelera
  async function gameDependencies(t, game) {
    const { n: corrections } = await t.get('SELECT COUNT(*)::int AS n FROM domino.corrections WHERE game_id = $1', [game.id]);
    let tournament = null;
    if (game.tournamentId) tournament = (await t.get('SELECT id, name FROM domino.tournaments WHERE id = $1', [game.tournamentId])) ?? null;
    const rematches = await t.all('SELECT id FROM domino.games WHERE rematch_of = $1', [game.id]);
    return { hands: game.hands.length, players: game.participants.length, corrections, tournament, rematches: rematches.map((r) => r.id) };
  }

  async function playerDependencies(t, playerId) {
    const { n: games } = await t.get('SELECT COUNT(*)::int AS n FROM domino.game_players WHERE player_id = $1', [playerId]);
    const account = await t.get('SELECT id, username FROM domino.users WHERE player_id = $1', [playerId]);
    const player = await playerById(t, playerId);
    const tours = (await t.all('SELECT * FROM domino.tournaments')).map(rowToTournament);
    const key = player.name.toLowerCase();
    const tournaments = tours.filter((x) => x.entrants.some((e) => e.players.some((p) => p.name.toLowerCase() === key))).map((x) => ({ id: x.id, name: x.name }));
    const { n: aliases } = await t.get('SELECT COUNT(*)::int AS n FROM domino.player_aliases WHERE player_id = $1', [playerId]);
    return { games, tournaments, account: account ?? null, aliases };
  }

  admin.get('/trash', async (req, res) => {
    const gameRows = await db.all('SELECT id, deleted_at, deleted_by FROM domino.games WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200');
    const games = await loadGames(db, gameRows.map((r) => r.id));
    const playerRows = await db.all(`${PLAYER_STATS_SQL} WHERE p.deleted_at IS NOT NULL ${PLAYER_GROUP} ORDER BY p.deleted_at DESC LIMIT 200`);
    const byId = new Map(gameRows.map((r) => [r.id, r]));
    res.json({
      games: await Promise.all(
        games.map(async (g) => ({ game: g, deletedBy: byId.get(g.id).deleted_by, dependencies: await gameDependencies(db, g) })),
      ),
      players: await Promise.all(
        playerRows.map(async (r) => ({ player: playerRow(r), deletedBy: (await playerById(db, r.id)).deleted_by, dependencies: await playerDependencies(db, r.id) })),
      ),
    });
  });

  admin.post('/trash/games/:id/restore', async (req, res) => {
    const reason = requireReason(req.body);
    await withLockedGame(
      req.params.id,
      async (t, game) => {
        if (!game.deletedAt) throw conflict('La partida no está en la papelera.');
        // Conflictos: se explican y no se restaura nada (sin restauraciones parciales).
        const problems = [];
        if (game.tournamentId && game.matchId && game.status !== 'cancelada') {
          const other = await t.get(
            "SELECT id FROM domino.games WHERE tournament_id = $1 AND match_id = $2 AND id <> $3 AND status <> 'cancelada' AND deleted_at IS NULL",
            [game.tournamentId, game.matchId, game.id],
          );
          if (other) problems.push(`El enfrentamiento del torneo ya tiene otra partida (${other.id}); restaurarla duplicaría el resultado.`);
        }
        const trashedPlayers = await t.all(
          `SELECT p.name FROM domino.game_players gp JOIN domino.players p ON p.id = gp.player_id
           WHERE gp.game_id = $1 AND p.deleted_at IS NOT NULL`,
          [game.id],
        );
        if (trashedPlayers.length) problems.push(`Restaura primero a: ${trashedPlayers.map((p) => p.name).join(', ')} (están en la papelera).`);
        if (problems.length) throw conflict(`No se puede restaurar. ${problems.join(' ')}`);
        // Sube la revisión administrativa para que el dispositivo de su dueño la recupere al sincronizar.
        await t.run('UPDATE domino.games SET deleted_at = NULL, deleted_by = NULL, revision = revision + 1, admin_revision = revision + 1, updated_at = $1 WHERE id = $2', [
          now(),
          game.id,
        ]);
        await logCorrection(t, req, { entity: 'partida', entityId: game.id, gameId: game.id, action: 'restaurar', reason, before: { deleted: true }, after: { deleted: false } });
      },
      { allowDeleted: true },
    );
    res.json({ game: await loadGame(db, req.params.id) });
  });

  function requireConfirm(body) {
    if (body?.confirm !== CONFIRM_WORD) throw bad(`Para eliminar definitivamente escribe ${CONFIRM_WORD}.`);
  }

  admin.delete('/trash/games/:id', async (req, res) => {
    const reason = requireReason(req.body);
    requireConfirm(req.body);
    await withLockedGame(
      req.params.id,
      async (t, game) => {
        if (!game.deletedAt) throw conflict('Solo se pueden eliminar definitivamente partidas que están en la papelera.');
        const deps = await gameDependencies(t, game);
        // Las manos y vínculos con jugadores se van con la partida; el registro de auditoría se conserva.
        await t.run('UPDATE domino.games SET rematch_of = NULL WHERE rematch_of = $1', [game.id]);
        await t.run('DELETE FROM domino.games WHERE id = $1', [game.id]);
        await t.run(
          'INSERT INTO domino.deleted_games (id, deleted_at) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET deleted_at = excluded.deleted_at',
          [game.id, now()],
        );
        await logCorrection(t, req, {
          entity: 'partida',
          entityId: game.id,
          gameId: game.id,
          action: 'eliminar_definitivo',
          reason,
          before: { status: game.status, mode: game.mode, target: game.target, totals: game.totals, sides: game.sides.map((s) => s.name), dependencies: deps },
        });
      },
      { allowDeleted: true },
    );
    res.status(204).end();
  });

  admin.post('/trash/players/:id/restore', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    await db.tx(async (t) => {
      const player = id && (await t.get('SELECT * FROM domino.players WHERE id = $1 FOR UPDATE', [id]));
      if (!player) throw notFound('El jugador no existe.');
      if (!player.deleted_at) throw conflict('El jugador no está en la papelera.');
      await t.run('UPDATE domino.players SET deleted_at = NULL, deleted_by = NULL, active = 1 WHERE id = $1', [id]);
      await logCorrection(t, req, { entity: 'jugador', entityId: id, action: 'restaurar', reason, before: { deleted: true }, after: { deleted: false, name: player.name } });
    });
    res.status(204).end();
  });

  // Solo se elimina definitivamente un perfil sin partidas ni torneos: así el historial sigue íntegro.
  admin.delete('/trash/players/:id', async (req, res) => {
    const reason = requireReason(req.body);
    requireConfirm(req.body);
    const id = toId(req.params.id);
    await db.tx(async (t) => {
      const player = id && (await t.get('SELECT * FROM domino.players WHERE id = $1 FOR UPDATE', [id]));
      if (!player) throw notFound('El jugador no existe.');
      if (!player.deleted_at) throw conflict('Solo se pueden eliminar definitivamente perfiles que están en la papelera.');
      const deps = await playerDependencies(t, id);
      if (deps.games > 0 || deps.tournaments.length > 0) {
        throw conflict(
          `No se puede eliminar definitivamente: participa en ${deps.games} partida(s) y ${deps.tournaments.length} torneo(s). Déjalo en la papelera o fusiónalo con otro perfil para conservar el historial.`,
        );
      }
      if (deps.account) await t.run('UPDATE domino.users SET player_id = NULL WHERE player_id = $1', [id]);
      await t.run('DELETE FROM domino.players WHERE id = $1', [id]);
      await logCorrection(t, req, { entity: 'jugador', entityId: id, action: 'eliminar_definitivo', reason, before: { name: player.name, dependencies: deps } });
    });
    res.status(204).end();
  });

  // ================================================================ Torneos
  async function tournamentView(t, row) {
    const tour = rowToTournament(row);
    const games = await gamesOfTournaments(t, [tour.id]);
    const { rounds, champion } = resolveBracket(tour, games);
    const owner = tour.ownerUserId ? await userById(t, tour.ownerUserId) : null;
    return {
      ...tour,
      owner: owner ? { id: owner.id, username: owner.username } : null,
      bracket: rounds,
      champion,
      gamesCount: games.length,
      started: games.some((g) => g.status !== 'cancelada'),
      games,
    };
  }

  admin.get('/tournaments', async (req, res) => {
    const { size, page, offset } = paging(req.query);
    const w = whereBuilder();
    if (['activo', 'pausado', 'cancelado'].includes(req.query.status)) w.add('status = ?', req.query.status);
    if (typeof req.query.search === 'string' && req.query.search.trim()) w.add("name ILIKE ? ESCAPE '\\'", likeParam(req.query.search));
    const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM domino.tournaments ${w.sql()}`, w.params);
    const rows = await db.all(`SELECT * FROM domino.tournaments ${w.sql()} ORDER BY created_at DESC LIMIT ${size} OFFSET ${offset}`, w.params);
    const views = await Promise.all(rows.map((r) => tournamentView(db, r)));
    res.json({ tournaments: views.map(({ games: _g, bracket: _b, ...v }) => v), total, page, size });
  });

  admin.get('/tournaments/:id', async (req, res) => {
    const row = await db.get('SELECT * FROM domino.tournaments WHERE id = $1', [req.params.id]);
    if (!row) throw notFound('El torneo no existe.');
    res.json({ tournament: await tournamentView(db, row) });
  });

  /** Participantes a partir de nombres; en parejas, dos jugadores distintos por pareja. */
  function buildEntrants(mode, list) {
    if (!Array.isArray(list) || list.length < 2 || list.length > 64) throw bad('El torneo necesita entre 2 y 64 participantes.');
    const size = mode === 'parejas' ? 2 : 1;
    const seen = new Set();
    return list.map((e, i) => {
      const names = Array.isArray(e?.players) ? e.players.map((n) => cleanName(n, 'El nombre del jugador')) : [];
      if (names.length !== size) throw bad(mode === 'parejas' ? `La pareja ${i + 1} necesita dos jugadores.` : 'Cada participante es un jugador.');
      for (const n of names) {
        if (seen.has(n.toLowerCase())) throw bad(`${n} aparece más de una vez en el torneo.`);
        seen.add(n.toLowerCase());
      }
      const teamName = typeof e.name === 'string' && e.name.trim() ? e.name.trim().replace(/\s+/g, ' ') : names.join(' y ');
      if (teamName.length > 80) throw bad('El nombre de una pareja es demasiado largo.');
      return { id: newId(), name: teamName, players: names.map((n) => ({ playerId: `s${n.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}${newId().slice(-6)}`, name: n })) };
    });
  }

  admin.post('/tournaments', async (req, res) => {
    const body = req.body ?? {};
    const name = cleanName(body.name, 'El nombre del torneo');
    if (!MODES.includes(body.mode)) throw bad('Elige la modalidad del torneo.');
    if (!Number.isInteger(body.target) || body.target < 1 || body.target > MAX_TARGET) throw bad('Elige una meta válida.');
    const entrants = buildEntrants(body.mode, body.entrants);
    let ownerId = req.user.id;
    if (body.ownerUserId !== undefined && body.ownerUserId !== null) {
      const owner = await userById(db, toId(body.ownerUserId));
      if (!owner || !owner.active) throw bad('El organizador elegido no existe o está desactivado.');
      ownerId = owner.id;
    }
    const at = now();
    const tour = { id: newId(), name, mode: body.mode, target: body.target, status: 'activo', entrants, rounds: drawBracket(entrants) };
    await db.tx(async (t) => {
      // Los jugadores quedan registrados como perfiles (reutiliza los existentes por nombre).
      for (const e of entrants) for (const p of e.players) await ctx.ensurePlayer(t, p.name);
      await t.run(
        `INSERT INTO domino.tournaments (id, name, mode, target, status, data_json, created_at, updated_at, revision, admin_revision, source_user_id)
         VALUES ($1, $2, $3, $4, 'activo', $5, $6, $6, 1, 1, $7)`,
        [tour.id, name, tour.mode, tour.target, JSON.stringify({ entrants, rounds: tour.rounds }), at, ownerId],
      );
      await logCorrection(t, req, {
        entity: 'torneo',
        entityId: tour.id,
        action: 'crear',
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : 'Alta de torneo',
        after: { name, mode: tour.mode, target: tour.target, entrants: entrants.map((e) => e.name), ownerUserId: ownerId },
      });
    });
    const row = await db.get('SELECT * FROM domino.tournaments WHERE id = $1', [tour.id]);
    res.status(201).json({ tournament: await tournamentView(db, row) });
  });

  /** Cambio administrativo de un torneo con la fila bloqueada; sube revisión y revisión administrativa. */
  async function withLockedTournament(id, fn) {
    return db.tx(async (t) => {
      const row = await t.get('SELECT * FROM domino.tournaments WHERE id = $1 FOR UPDATE', [id]);
      if (!row) throw notFound('El torneo no existe.');
      const tour = rowToTournament(row);
      const games = await gamesOfTournaments(t, [tour.id]);
      const next = await fn(t, tour, games);
      if (!next) return tour.id;
      await t.run(
        `UPDATE domino.tournaments SET name = $1, status = $2, data_json = $3, updated_at = $4,
           revision = revision + 1, admin_revision = revision + 1 WHERE id = $5`,
        [next.name, next.status, JSON.stringify({ entrants: next.entrants, rounds: next.rounds }), now(), tour.id],
      );
      return tour.id;
    });
  }

  admin.patch('/tournaments/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const action = req.body?.action;
    const target = { pausar: 'pausado', reanudar: 'activo', cancelar: 'cancelado' }[action];
    if (!target) throw bad('Acción inválida: usa pausar, reanudar o cancelar.');
    const id = await withLockedTournament(req.params.id, async (t, tour, games) => {
      if (tour.status === 'cancelado') throw conflict('El torneo está cancelado; ya no se puede modificar.');
      if (resolveBracket(tour, games).champion) throw conflict('El torneo ya terminó.');
      if (tour.status === target) throw bad(`El torneo ya está ${target}.`);
      if (action === 'reanudar' && tour.status !== 'pausado') throw bad('Solo se puede reanudar un torneo en pausa.');
      await logCorrection(t, req, { entity: 'torneo', entityId: tour.id, action, reason, before: { status: tour.status }, after: { status: target } });
      return { ...tour, status: target };
    });
    const row = await db.get('SELECT * FROM domino.tournaments WHERE id = $1', [id]);
    res.json({ tournament: await tournamentView(db, row) });
  });

  // Gestionar participantes: cambiar el nombre de la pareja o reemplazar jugadores de quien todavía
  // no jugó. Si el participante ya tiene una partida, cambiarlo invalidaría ese enfrentamiento.
  admin.patch('/tournaments/:id/entrants/:entrantId', async (req, res) => {
    const reason = requireReason(req.body);
    const id = await withLockedTournament(req.params.id, async (t, tour, games) => {
      if (tour.status === 'cancelado') throw conflict('El torneo está cancelado.');
      const entrant = tour.entrants.find((e) => e.id === req.params.entrantId);
      if (!entrant) throw notFound('El participante no existe.');
      const next = { ...entrant };
      if (req.body.players !== undefined) {
        if (startedEntrantIds(tour, games).has(entrant.id)) {
          throw conflict('No se pueden cambiar los jugadores: este participante ya tiene una partida en el torneo.');
        }
        const names = Array.isArray(req.body.players) ? req.body.players.map((n) => cleanName(n, 'El nombre del jugador')) : [];
        if (names.length !== entrant.players.length) throw bad(tour.mode === 'parejas' ? 'Una pareja necesita dos jugadores.' : 'Indica el jugador.');
        const others = new Set(tour.entrants.filter((e) => e.id !== entrant.id).flatMap((e) => e.players.map((p) => p.name.toLowerCase())));
        const mine = new Set();
        for (const n of names) {
          if (others.has(n.toLowerCase()) || mine.has(n.toLowerCase())) throw conflict(`${n} ya está en el torneo.`);
          mine.add(n.toLowerCase());
          await ctx.ensurePlayer(t, n);
        }
        next.players = names.map((n, i) =>
          entrant.players[i]?.name.toLowerCase() === n.toLowerCase() ? entrant.players[i] : { playerId: `s${newId()}`, name: n },
        );
        if (tour.mode === 'individual') next.name = names[0];
      }
      if (req.body.name !== undefined) {
        if (tour.mode !== 'parejas') throw bad('En individual el participante se llama como el jugador.');
        const teamName = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
        if (!teamName || teamName.length > 80) throw bad('Escribe el nombre de la pareja (máximo 80 caracteres).');
        if (tour.entrants.some((e) => e.id !== entrant.id && e.name.toLowerCase() === teamName.toLowerCase())) throw conflict('Ya hay una pareja con ese nombre.');
        next.name = teamName;
      }
      await logCorrection(t, req, {
        entity: 'torneo',
        entityId: tour.id,
        action: 'editar_participante',
        reason,
        before: { name: entrant.name, players: entrant.players.map((p) => p.name) },
        after: { name: next.name, players: next.players.map((p) => p.name) },
      });
      return { ...tour, entrants: tour.entrants.map((e) => (e.id === entrant.id ? next : e)) };
    });
    const row = await db.get('SELECT * FROM domino.tournaments WHERE id = $1', [id]);
    res.json({ tournament: await tournamentView(db, row) });
  });

  // Agregar o quitar participantes y volver a sortear el cuadro: solo si aún no se jugó ninguna partida.
  admin.put('/tournaments/:id/entrants', async (req, res) => {
    const reason = requireReason(req.body);
    const id = await withLockedTournament(req.params.id, async (t, tour, games) => {
      if (tour.status === 'cancelado') throw conflict('El torneo está cancelado.');
      if (games.some((g) => g.status !== 'cancelada')) {
        throw conflict('Ya se jugaron partidas del torneo: volver a sortear invalidaría los enfrentamientos iniciados.');
      }
      const entrants = buildEntrants(tour.mode, req.body?.entrants);
      for (const e of entrants) for (const p of e.players) await ctx.ensurePlayer(t, p.name);
      await logCorrection(t, req, {
        entity: 'torneo',
        entityId: tour.id,
        action: 'resortear',
        reason,
        before: { entrants: tour.entrants.map((e) => e.name) },
        after: { entrants: entrants.map((e) => e.name) },
      });
      return { ...tour, entrants, rounds: drawBracket(entrants) };
    });
    const row = await db.get('SELECT * FROM domino.tournaments WHERE id = $1', [id]);
    res.json({ tournament: await tournamentView(db, row) });
  });

  // ================================================================ Ranking
  admin.get('/ranking', async (req, res) => {
    const rows = (await db.all(`${PLAYER_STATS_SQL} WHERE p.deleted_at IS NULL ${PLAYER_GROUP} HAVING COUNT(g.id) > 0`)).map(playerRow);
    rows.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || a.name.localeCompare(b.name));
    res.json({ ranking: rows.map((r, i) => ({ position: i + 1, ...r })) });
  });

  // ================================================================ Auditoría (solo lectura)
  function auditRow(r) {
    return {
      id: r.id,
      createdAt: r.created_at,
      adminUsername: r.admin_username,
      entity: r.entity,
      entityId: r.entity_id,
      gameId: r.game_id,
      action: r.action,
      reason: r.reason,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    };
  }

  async function auditQuery(query) {
    const { size, page, offset } = paging(query);
    const w = whereBuilder();
    if (typeof query.entity === 'string' && /^[a-z_]{1,30}$/.test(query.entity)) w.add('entity = ?', query.entity);
    if (typeof query.search === 'string' && query.search.trim()) {
      const like = likeParam(query.search);
      const p = w.param(like);
      w.add(`(reason ILIKE ${p} ESCAPE '\\' OR admin_username ILIKE ${p} ESCAPE '\\' OR entity_id ILIKE ${p} ESCAPE '\\' OR action ILIKE ${p} ESCAPE '\\')`);
    }
    if (isDay(query.from)) w.add('substr(created_at, 1, 10) >= ?', query.from);
    if (isDay(query.to)) w.add('substr(created_at, 1, 10) <= ?', query.to);
    const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM domino.corrections ${w.sql()}`, w.params);
    const rows = await db.all(`SELECT * FROM domino.corrections ${w.sql()} ORDER BY id DESC LIMIT ${size} OFFSET ${offset}`, w.params);
    return { corrections: rows.map(auditRow), total, page, size };
  }

  admin.get('/audit', async (req, res) => res.json(await auditQuery(req.query)));
  admin.get('/corrections', async (req, res) => res.json(await auditQuery({ size: 100, ...req.query })));

  // ================================================================ Reglas (valores predeterminados)
  admin.get('/settings', async (req, res) => res.json({ settings: await getSettings(db) }));

  admin.put('/settings', async (req, res) => {
    const body = req.body ?? {};
    const targets = body.defaultTargets;
    if (
      !Array.isArray(targets) ||
      targets.length < 1 ||
      targets.length > 8 ||
      targets.some((t) => !Number.isInteger(t) || t < 1 || t > MAX_TARGET)
    ) {
      throw bad(`Las metas deben ser entre 1 y 8 números enteros entre 1 y ${MAX_TARGET}.`);
    }
    const uniqueTargets = [...new Set(targets)].sort((a, b) => a - b);
    const defaultTarget = body.defaultTarget;
    if (!uniqueTargets.includes(defaultTarget)) throw bad('La meta predeterminada debe estar en la lista de metas.');
    const defaultMode = body.defaultMode ?? DEFAULT_SETTINGS.defaultMode;
    if (!MODES.includes(defaultMode)) throw bad('Modalidad predeterminada inválida.');
    const passPoints = body.rules?.passPoints ?? 0;
    if (!isNonNegativeInt(passPoints, MAX_HAND_POINTS)) throw bad(`Los puntos por pase deben ser un entero entre 0 y ${MAX_HAND_POINTS}.`);
    const settings = { defaultTargets: uniqueTargets, defaultTarget, defaultMode, rules: { passPoints } };
    await db.tx(async (t) => {
      const before = await getSettings(t);
      await saveSettings(t, settings);
      await logCorrection(t, req, {
        entity: 'configuracion',
        entityId: 'reglas',
        action: 'editar',
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : 'Actualización de reglas predeterminadas',
        before,
        after: settings,
      });
    });
    res.json({ settings: await getSettings(db) });
  });

  // ================================================================ Identidad visual
  const brandingForLog = (b) => ({ ...b, logo: b.logo ? describeImage(b.logoInfo ?? { type: b.logo.slice(5, b.logo.indexOf(';')), bytes: Math.round((b.logo.length * 3) / 4) }) : null });

  admin.get('/branding', async (req, res) => res.json({ branding: await getBranding(db), defaults: DEFAULT_BRANDING }));

  admin.put('/branding', async (req, res) => {
    const body = req.body ?? {};
    const text = (value, field, max, required = false) => {
      const v = typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ') : '';
      if (required && !v) throw bad(`${field} es obligatorio.`);
      if (v.length > max) throw bad(`${field} no puede superar ${max} caracteres.`);
      return v;
    };
    const branding = {
      appName: text(body.appName, 'El nombre de la app', 30, true),
      tagline: text(body.tagline, 'El subtítulo', 60),
      homeText: text(body.homeText, 'El texto de bienvenida', 200),
      logo: body.logo ? validateImage(body.logo, { maxBytes: LOGO_MAX_BYTES, minSide: 1, maxSide: 4096, label: 'El logo' }).dataUri : null,
    };
    await db.tx(async (t) => {
      const before = await getBranding(t);
      await saveBranding(t, branding);
      await logCorrection(t, req, {
        entity: 'configuracion',
        entityId: 'identidad',
        action: 'editar',
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : 'Actualización de identidad visual',
        before: brandingForLog(before),
        after: brandingForLog(branding),
      });
    });
    res.json({ branding });
  });

  admin.delete('/branding', async (req, res) => {
    const reason = requireReason(req.body);
    await db.tx(async (t) => {
      const before = await getBranding(t);
      await saveBranding(t, DEFAULT_BRANDING);
      await logCorrection(t, req, { entity: 'configuracion', entityId: 'identidad', action: 'restaurar', reason, before: brandingForLog(before), after: brandingForLog(DEFAULT_BRANDING) });
    });
    res.json({ branding: DEFAULT_BRANDING });
  });

  // ================================================================ Apariencia (tema global)
  admin.get('/appearance', async (req, res) => res.json({ appearance: await getAppearance(db), defaults: DEFAULT_APPEARANCE }));

  admin.put('/appearance', async (req, res) => {
    const appearance = validateAppearance(req.body);
    await db.tx(async (t) => {
      const before = await getAppearance(t);
      await saveAppearance(t, appearance);
      await logCorrection(t, req, {
        entity: 'configuracion',
        entityId: 'apariencia',
        action: 'editar',
        reason: typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 500) : 'Cambio de tema',
        before,
        after: appearance,
      });
    });
    res.json({ appearance });
  });

  admin.delete('/appearance', async (req, res) => {
    const reason = requireReason(req.body);
    await db.tx(async (t) => {
      const before = await getAppearance(t);
      await saveAppearance(t, DEFAULT_APPEARANCE);
      await logCorrection(t, req, { entity: 'configuracion', entityId: 'apariencia', action: 'restaurar', reason, before, after: DEFAULT_APPEARANCE });
    });
    res.json({ appearance: DEFAULT_APPEARANCE });
  });

  // ================================================================ Exportación CSV
  // Sin credenciales, correos, fotos ni identificadores internos de cuentas.
  admin.get('/export/:kind', async (req, res) => {
    const kind = req.params.kind;
    const day = new Date().toISOString().slice(0, 10);
    let csv;
    if (kind === 'jugadores' || kind === 'estadisticas') {
      const w = whereBuilder();
      w.add('p.deleted_at IS NULL');
      if (typeof req.query.player === 'string' && req.query.player.trim()) w.add("p.name ILIKE ? ESCAPE '\\'", likeParam(req.query.player));
      // Las fechas filtran las partidas que cuentan para las estadísticas.
      const dateCond = [];
      if (isDay(req.query.from)) dateCond.push(`substr(g.created_at, 1, 10) >= ${w.param(req.query.from)}`);
      if (isDay(req.query.to)) dateCond.push(`substr(g.created_at, 1, 10) <= ${w.param(req.query.to)}`);
      const sql = PLAYER_STATS_SQL.replace(
        'AND g.practice = 0 AND g.deleted_at IS NULL',
        `AND g.practice = 0 AND g.deleted_at IS NULL${dateCond.map((c) => ` AND ${c}`).join('')}`,
      );
      const rows = (await db.all(`${sql} ${w.sql()} ${PLAYER_GROUP} ORDER BY lower(p.name)`, w.params)).map(playerRow);
      csv =
        kind === 'jugadores'
          ? toCsv(['Jugador', 'Activo', 'Alta'], rows.map((r) => [r.name, r.active ? 'sí' : 'no', r.createdAt.slice(0, 10)]))
          : toCsv(
              ['Jugador', 'Partidas', 'Ganadas', 'Perdidas', 'Pendientes', '% victorias', 'Puntos'],
              rows.map((r) => [r.name, r.played, r.wins, r.losses, r.pending, r.winRate, r.points]),
            );
    } else if (kind === 'partidas' || kind === 'resultados') {
      const w = gameFilters(req.query);
      const ids = (await db.all(`SELECT g.id FROM domino.games g ${w.sql()} ORDER BY g.created_at DESC LIMIT 5000`, w.params)).map((r) => r.id);
      const games = await loadGames(db, ids);
      if (kind === 'partidas') {
        csv = toCsv(
          ['Partida', 'Inicio', 'Fin', 'Estado', 'Modalidad', 'Meta', 'Lados', 'Marcador', 'Ganador', 'Manos', 'Prueba', 'Torneo'],
          games.map((g) => [
            g.id,
            g.createdAt,
            g.finishedAt ?? '',
            g.status,
            g.mode,
            g.target,
            g.sides.map((s) => s.name).join(' vs '),
            g.sides.map((s) => g.totals[s.id] ?? 0).join(' - '),
            g.sides.find((s) => s.id === g.winnerSideId)?.name ?? '',
            g.hands.length,
            g.practice ? 'sí' : 'no',
            g.tournamentId ?? '',
          ]),
        );
      } else {
        const rows = [];
        for (const g of games) {
          for (const side of g.sides) {
            for (const pid of side.participantIds) {
              const p = g.participants.find((x) => x.id === pid);
              rows.push([
                g.id,
                g.createdAt.slice(0, 10),
                p?.name ?? '',
                side.name,
                g.totals[side.id] ?? 0,
                g.status !== 'terminada' ? g.status : side.id === g.winnerSideId ? 'ganó' : 'perdió',
                g.practice ? 'sí' : 'no',
              ]);
            }
          }
        }
        csv = toCsv(['Partida', 'Fecha', 'Jugador', 'Lado', 'Puntos del lado', 'Resultado', 'Prueba'], rows);
      }
    } else {
      throw notFound('Exportación desconocida.');
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="domino-${kind}-${day}.csv"`);
    res.send(csv);
  });

  // ================================================================ Cuentas de acceso
  // El rol de propietario no se asigna desde la app (solo con el script del servidor). Solo el
  // propietario gestiona cuentas de administrador; los administradores gestionan anotadores.
  admin.get('/users', async (req, res) => {
    res.json({ users: (await db.all('SELECT * FROM domino.users ORDER BY lower(username)')).map(publicUser) });
  });

  async function checkPlayerLink(t, value, userId = null) {
    if (value === null) return null;
    const pid = toId(value);
    const player = pid && (await playerById(t, pid));
    if (!player || player.deleted_at) throw bad('El perfil de jugador no existe.');
    const taken = await t.get('SELECT id FROM domino.users WHERE player_id = $1 AND id <> $2', [pid, userId ?? 0]);
    if (taken) throw conflict('Ese perfil ya está vinculado a otra cuenta.');
    return pid;
  }

  admin.post('/users', async (req, res) => {
    const username = cleanName(req.body?.username, 'El usuario');
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'anotador') throw bad('Rol inválido.');
    if (role === 'admin' && !isOwner(req)) throw new HttpError(403, 'Solo el propietario puede crear administradores.');
    const email = req.body?.email ? cleanEmail(req.body.email) : null;
    const weak = validatePasswordStrength(req.body?.password);
    if (weak) throw bad(weak);
    if (await db.get('SELECT 1 AS x FROM domino.users WHERE lower(username) = lower($1)', [username])) throw conflict('Ese usuario ya existe.');
    if (email && (await db.get('SELECT 1 AS x FROM domino.users WHERE lower(email) = $1', [email]))) throw conflict('Ese correo ya está en uso.');
    const user = await db.tx(async (t) => {
      const playerId = req.body?.playerId !== undefined ? await checkPlayerLink(t, req.body.playerId) : null;
      const created = await t.get(
        'INSERT INTO domino.users (username, email, password_hash, role, active, created_at, player_id) VALUES ($1, $2, $3, $4, 1, $5, $6) RETURNING *',
        [username, email, hashPassword(req.body.password), role, now(), playerId],
      );
      await logCorrection(t, req, { entity: 'usuario', entityId: created.id, action: 'crear', reason: 'Alta de usuario', after: auditUser(created) });
      return created;
    });
    res.status(201).json({ user: publicUser(user) });
  });

  admin.patch('/users/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    const user = id && (await userById(db, id));
    if (!user) throw notFound('El usuario no existe.');
    const isSelf = user.id === req.user.id;
    if (user.role === 'propietario' && !isSelf) throw new HttpError(403, 'La cuenta del propietario solo la modifica el propietario.');
    if (user.role === 'admin' && !isSelf && !isOwner(req)) throw new HttpError(403, 'Solo el propietario puede modificar cuentas de administrador.');
    let { role, active, password_hash, email, player_id } = user;
    if (req.body.role !== undefined) {
      if (req.body.role !== 'admin' && req.body.role !== 'anotador') throw bad('Rol inválido.');
      if (isSelf) throw bad('No puedes cambiar tu propio rol.');
      if (req.body.role === 'admin' && !isOwner(req)) throw new HttpError(403, 'Solo el propietario puede nombrar administradores.');
      role = req.body.role;
    }
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') throw bad('Estado inválido.');
      if (isSelf && !req.body.active) throw bad('No puedes desactivar tu propio usuario.');
      active = req.body.active ? 1 : 0;
    }
    if (req.body.password !== undefined) {
      const weak = validatePasswordStrength(req.body.password);
      if (weak) throw bad(weak);
      password_hash = hashPassword(req.body.password);
    }
    if (req.body.email !== undefined) {
      email = req.body.email === null || req.body.email === '' ? null : cleanEmail(req.body.email);
      if (email && (await db.get('SELECT 1 AS x FROM domino.users WHERE lower(email) = $1 AND id <> $2', [email, user.id]))) {
        throw conflict('Ese correo ya está en uso.');
      }
    }
    const updated = await db.tx(async (t) => {
      if (req.body.playerId !== undefined) player_id = await checkPlayerLink(t, req.body.playerId, user.id);
      // Cambiar rol, estado o contraseña cierra las sesiones abiertas de la cuenta.
      const closeSessions = req.body.role !== undefined || req.body.active !== undefined || req.body.password !== undefined;
      const row = await t.get(
        `UPDATE domino.users SET role = $1, active = $2, password_hash = $3, email = $4, player_id = $5,
           token_version = token_version + $6 WHERE id = $7 RETURNING *`,
        [role, active, password_hash, email, player_id, closeSessions ? 1 : 0, user.id],
      );
      await logCorrection(t, req, {
        entity: 'usuario',
        entityId: user.id,
        action: 'editar',
        reason,
        before: auditUser(user),
        after: { ...auditUser(row), passwordChanged: req.body.password !== undefined },
      });
      return row;
    });
    res.json({ user: publicUser(updated) });
  });
}
