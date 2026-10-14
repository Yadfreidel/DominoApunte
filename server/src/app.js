import cors from 'cors';
import express from 'express';
import {
  authenticate,
  createLoginLimiter,
  hashPassword,
  publicUser,
  requireRole,
  signToken,
  validatePasswordStrength,
  verifyPassword,
} from './auth.js';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from './db.js';
import { isNonNegativeInt, MAX_HAND_POINTS, MAX_TARGET, recompute } from './domain.js';
import { createDominoAnalyzer, VisionError } from './vision.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => new HttpError(400, message);
const notFound = (message) => new HttpError(404, message);

const STATUSES = ['pendiente', 'terminada', 'cancelada'];
const MODES = ['individual', 'parejas'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 40;

function cleanName(value, field = 'El nombre') {
  if (typeof value !== 'string') throw bad(`${field} es obligatorio.`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw bad(`${field} es obligatorio.`);
  if (name.length > MAX_NAME) throw bad(`${field} no puede superar ${MAX_NAME} caracteres.`);
  return name;
}

function requireReason(body) {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) throw bad('Indica el motivo de la corrección (mínimo 3 caracteres).');
  if (reason.length > 500) throw bad('El motivo no puede superar 500 caracteres.');
  return reason;
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Valida una partida enviada por un dispositivo. Devuelve una copia normalizada. */
export function validateIncomingGame(g) {
  if (!g || typeof g !== 'object') throw bad('Partida inválida.');
  if (!ID_RE.test(g.id ?? '')) throw bad('Identificador de partida inválido.');
  if (!MODES.includes(g.mode)) throw bad('Modalidad inválida.');
  if (!STATUSES.includes(g.status)) throw bad('Estado inválido.');
  if (!Number.isInteger(g.target) || g.target < 1 || g.target > MAX_TARGET) throw bad('Meta inválida.');
  if (!isIsoDate(g.createdAt) || !isIsoDate(g.updatedAt)) throw bad('Fechas inválidas.');
  if (!Number.isInteger(g.revision) || g.revision < 0) throw bad('Revisión inválida.');
  if (!Array.isArray(g.participants) || g.participants.length < 2 || g.participants.length > 4) {
    throw bad('La partida debe tener entre 2 y 4 jugadores.');
  }
  const participants = g.participants.map((p) => {
    if (!ID_RE.test(p?.id ?? '')) throw bad('Jugador inválido.');
    return { id: p.id, name: cleanName(p.name, 'El nombre del jugador') };
  });
  const participantIds = new Set(participants.map((p) => p.id));
  if (participantIds.size !== participants.length) throw bad('Jugadores repetidos.');
  if (!Array.isArray(g.sides) || g.sides.length < 2 || g.sides.length > 4) throw bad('Lados inválidos.');
  const sides = g.sides.map((s) => {
    if (!ID_RE.test(s?.id ?? '')) throw bad('Lado inválido.');
    if (!Array.isArray(s.participantIds) || s.participantIds.some((id) => !participantIds.has(id))) {
      throw bad('Lado con jugadores desconocidos.');
    }
    return { id: s.id, name: cleanName(s.name, 'El nombre del equipo'), participantIds: [...s.participantIds] };
  });
  if (sides.some((s) => s.participantIds.length < 1 || s.participantIds.length > 2)) {
    throw bad('Cada lado debe tener uno o dos jugadores.');
  }
  if (g.mode === 'parejas' && sides.length !== 2) {
    // Por parejas: 2 equipos; basta un jugador anotado por pareja (el compañero es opcional).
    throw bad('La modalidad por parejas requiere 2 equipos.');
  }
  const sideIds = new Set(sides.map((s) => s.id));
  if (!Array.isArray(g.hands) || g.hands.length > 2000) throw bad('Manos inválidas.');
  const handIds = new Set();
  const hands = g.hands.map((h) => {
    if (!ID_RE.test(h?.id ?? '') || handIds.has(h.id)) throw bad('Mano inválida o repetida.');
    handIds.add(h.id);
    if (!sideIds.has(h.sideId)) throw bad('Mano asignada a un lado desconocido.');
    if (!isNonNegativeInt(h.points, MAX_HAND_POINTS)) throw bad('Los puntos deben ser enteros no negativos.');
    if (!isIsoDate(h.createdAt)) throw bad('Fecha de mano inválida.');
    return {
      id: h.id,
      sideId: h.sideId,
      points: h.points,
      createdAt: h.createdAt,
      editedAt: isIsoDate(h.editedAt) ? h.editedAt : null,
    };
  });
  return {
    id: g.id,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    finishedAt: isIsoDate(g.finishedAt) ? g.finishedAt : null,
    status: g.status,
    mode: g.mode,
    target: g.target,
    participants,
    sides,
    hands,
    winnerSideId: null,
    rematchOf: typeof g.rematchOf === 'string' && ID_RE.test(g.rematchOf) ? g.rematchOf : null,
    revision: g.revision,
    adminRevision: Number.isInteger(g.adminRevision) && g.adminRevision >= 0 ? g.adminRevision : 0,
  };
}

export function createApp({ db, jwtSecret, jwtExpiresIn = '12h', corsOrigins = [], visionAnalyzer = createDominoAnalyzer() }) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : '*' }));
  const smallJson = express.json({ limit: '2mb' });
  // Solo la ruta de conteo de fichas acepta cuerpos grandes (la foto en base64).
  const imageJson = express.json({ limit: '8mb' });
  app.use((req, res, next) => (req.path === '/api/vision/dominoes' ? imageJson : smallJson)(req, res, next));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  const auth = authenticate(db, jwtSecret);
  const adminOnly = [auth, requireRole('admin')];
  const limiter = createLoginLimiter();
  const now = () => new Date().toISOString();

  // ---------- Consultas reutilizables ----------
  // `t` es la base de datos o una transacción en curso: ambas tienen get/all/run.
  const userByName = (t, name) => t.get('SELECT * FROM domino.users WHERE lower(username) = lower($1)', [name]);
  const userById = (t, id) => t.get('SELECT * FROM domino.users WHERE id = $1', [id]);
  const playerByName = (t, name) => t.get('SELECT * FROM domino.players WHERE lower(name) = lower($1)', [name]);
  const playerById = (t, id) => t.get('SELECT * FROM domino.players WHERE id = $1', [id]);
  const gameRow = (t, id) => t.get('SELECT * FROM domino.games WHERE id = $1', [id]);
  const isDeleted = async (t, id) => !!(await t.get('SELECT 1 AS x FROM domino.deleted_games WHERE id = $1', [id]));
  const toId = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
  };

  async function logCorrection(t, req, { entity, entityId, gameId = null, action, reason, before = null, after = null }) {
    await t.run(
      `INSERT INTO domino.corrections (created_at, admin_user_id, admin_username, entity, entity_id, game_id, action, reason, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        now(),
        req.user.id,
        req.user.username,
        entity,
        String(entityId),
        gameId,
        action,
        reason,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
      ],
    );
  }

  function rowToGame(row, handRows) {
    const hands = handRows.map((h) => ({
      id: h.id,
      sideId: h.side_id,
      points: h.points,
      createdAt: h.created_at,
      editedAt: h.edited_at,
    }));
    const sides = JSON.parse(row.sides_json);
    const totals = Object.fromEntries(sides.map((s) => [s.id, 0]));
    for (const h of hands) if (h.sideId in totals) totals[h.sideId] += h.points;
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      status: row.status,
      mode: row.mode,
      target: row.target,
      participants: JSON.parse(row.participants_json),
      sides,
      hands,
      totals,
      winnerSideId: row.winner_side_id,
      rematchOf: row.rematch_of,
      revision: row.revision,
      adminLocked: row.admin_revision > 0,
      adminRevision: row.admin_revision,
    };
  }

  /** Carga varias partidas completas con dos consultas, conservando el orden de `ids`. */
  async function loadGames(t, ids) {
    if (ids.length === 0) return [];
    const rows = await t.all('SELECT * FROM domino.games WHERE id = ANY($1::text[])', [ids]);
    const hands = await t.all('SELECT * FROM domino.hands WHERE game_id = ANY($1::text[]) ORDER BY game_id, seq', [ids]);
    const handsByGame = new Map();
    for (const h of hands) {
      if (!handsByGame.has(h.game_id)) handsByGame.set(h.game_id, []);
      handsByGame.get(h.game_id).push(h);
    }
    const byId = new Map(rows.map((r) => [r.id, rowToGame(r, handsByGame.get(r.id) ?? [])]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async function loadGame(t, id) {
    return (await loadGames(t, [id]))[0] ?? null;
  }

  async function requireGame(t, id) {
    const game = await loadGame(t, id);
    if (!game) throw notFound('La partida no existe.');
    return game;
  }

  /** Devuelve el id del jugador con ese nombre, creándolo si no existe (seguro ante altas simultáneas). */
  async function ensurePlayer(t, name) {
    await t.run(
      'INSERT INTO domino.players (name, active, created_at) VALUES ($1, 1, $2) ON CONFLICT ((lower(name))) DO NOTHING',
      [name, now()],
    );
    return (await playerByName(t, name)).id;
  }

  /** Guarda la partida completa (cabecera, manos y vínculos con jugadores). Usar dentro de una transacción. */
  async function writeGame(t, game, { adminRevision, sourceUserId }) {
    await t.run(
      `INSERT INTO domino.games (id, created_at, updated_at, finished_at, status, mode, target, participants_json, sides_json,
                                 winner_side_id, rematch_of, revision, admin_revision, source_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         updated_at = excluded.updated_at, finished_at = excluded.finished_at, status = excluded.status,
         mode = excluded.mode, target = excluded.target, participants_json = excluded.participants_json,
         sides_json = excluded.sides_json, winner_side_id = excluded.winner_side_id, rematch_of = excluded.rematch_of,
         revision = excluded.revision, admin_revision = excluded.admin_revision`,
      [
        game.id,
        game.createdAt,
        game.updatedAt,
        game.finishedAt,
        game.status,
        game.mode,
        game.target,
        JSON.stringify(game.participants),
        JSON.stringify(game.sides),
        game.winnerSideId,
        game.rematchOf,
        game.revision,
        adminRevision,
        sourceUserId ?? null,
      ],
    );
    await t.run('DELETE FROM domino.hands WHERE game_id = $1', [game.id]);
    if (game.hands.length) {
      // Todas las manos en una sola instrucción.
      await t.run(
        `INSERT INTO domino.hands (id, game_id, seq, side_id, points, created_at, edited_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::int[], $6::text[], $7::text[])`,
        [
          game.hands.map((h) => h.id),
          game.hands.map(() => game.id),
          game.hands.map((_, i) => i),
          game.hands.map((h) => h.sideId),
          game.hands.map((h) => h.points),
          game.hands.map((h) => h.createdAt),
          game.hands.map((h) => h.editedAt ?? null),
        ],
      );
    }
    await t.run('DELETE FROM domino.game_players WHERE game_id = $1', [game.id]);
    for (const side of game.sides) {
      for (const pid of side.participantIds) {
        const participant = game.participants.find((p) => p.id === pid);
        if (!participant) continue;
        await t.run(
          'INSERT INTO domino.game_players (game_id, player_id, side_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [game.id, await ensurePlayer(t, participant.name), side.id],
        );
      }
    }
  }

  /** Aplica un cambio administrativo: recalcula, sube la revisión y marca la corrección. */
  async function saveAdminChange(t, game) {
    const updated = recompute(game, game.hands, now());
    updated.updatedAt = now();
    updated.revision = game.revision + 1;
    await writeGame(t, updated, { adminRevision: updated.revision });
    return updated;
  }

  const playerStatsSql = `
    SELECT p.id, p.name, p.active, p.created_at,
      COUNT(g.id)::int AS played,
      COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id = gp.side_id THEN 1 ELSE 0 END), 0)::int AS wins,
      COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id <> gp.side_id THEN 1 ELSE 0 END), 0)::int AS losses,
      COALESCE(SUM(CASE WHEN g.status = 'pendiente' THEN 1 ELSE 0 END), 0)::int AS pending,
      COALESCE(SUM(CASE WHEN g.status = 'cancelada' THEN 1 ELSE 0 END), 0)::int AS cancelled,
      COALESCE(SUM(hp.pts), 0)::int AS points
    FROM domino.players p
    LEFT JOIN domino.game_players gp ON gp.player_id = p.id
    LEFT JOIN domino.games g ON g.id = gp.game_id
    LEFT JOIN (SELECT game_id, side_id, SUM(points) AS pts FROM domino.hands GROUP BY game_id, side_id) hp
      ON hp.game_id = gp.game_id AND hp.side_id = gp.side_id`;

  function withPct(row) {
    const decided = row.wins + row.losses;
    return {
      id: row.id,
      name: row.name,
      active: !!row.active,
      createdAt: row.created_at,
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      pending: row.pending,
      cancelled: row.cancelled,
      points: row.points,
      winRate: decided ? Math.round((row.wins / decided) * 1000) / 10 : 0,
    };
  }

  // ---------- Públicas ----------
  app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

  app.post('/api/auth/login', async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) throw bad('Ingresa usuario y contraseña.');
    if (limiter.isBlocked(req, username)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
    }
    const user = await userByName(db, username);
    const valid = verifyPassword(password, user?.password_hash ?? null);
    if (!user || !valid || !user.active) {
      limiter.fail(req, username);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    limiter.reset(req, username);
    res.json({ token: signToken(user, jwtSecret, jwtExpiresIn), user: publicUser(user) });
  });

  // ---------- Usuario autenticado (anotador o administrador) ----------
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/settings', auth, async (req, res) => res.json({ settings: await getSettings(db) }));

  app.post('/api/sync/games', auth, async (req, res) => {
    const incoming = req.body?.games;
    if (!Array.isArray(incoming) || incoming.length > 200) throw bad('Envía entre 0 y 200 partidas.');
    const accepted = [];
    const serverVersionIds = [];
    const deleted = [];
    const errors = [];
    for (const raw of incoming) {
      let game;
      try {
        game = validateIncomingGame(raw);
      } catch (err) {
        errors.push({ id: typeof raw?.id === 'string' ? raw.id.slice(0, 64) : null, error: err.message });
        continue;
      }
      // Lectura y escritura en la misma transacción, con la fila bloqueada, para que dos
      // dispositivos que sincronizan a la vez no se pisen.
      const outcome = await db.tx(async (t) => {
        if (await isDeleted(t, game.id)) return 'deleted';
        const existing = await t.get('SELECT revision, admin_revision FROM domino.games WHERE id = $1 FOR UPDATE', [game.id]);
        if (existing && existing.admin_revision > 0 && game.adminRevision !== existing.admin_revision) {
          // Un administrador corrigió esta partida y el dispositivo aún no tiene esa corrección:
          // el servidor manda y el dispositivo debe adoptar su versión.
          return 'server';
        }
        if (existing && existing.revision >= game.revision) return { revision: existing.revision };
        const normalized = recompute(game, game.hands, game.updatedAt);
        await writeGame(t, normalized, { adminRevision: existing?.admin_revision ?? 0, sourceUserId: req.user.id });
        return { revision: game.revision };
      });
      if (outcome === 'deleted') deleted.push(game.id);
      else if (outcome === 'server') serverVersionIds.push(game.id);
      else accepted.push({ id: game.id, revision: outcome.revision });
    }

    // Partidas que el dispositivo ya tenía sincronizadas: se le avisa si un administrador
    // las corrigió o eliminó desde entonces.
    const known = (Array.isArray(req.body?.known) ? req.body.known.slice(0, 2000) : []).filter((k) => ID_RE.test(k?.id ?? ''));
    if (known.length) {
      const ids = known.map((k) => k.id);
      const deletedRows = await db.all('SELECT id FROM domino.deleted_games WHERE id = ANY($1::text[])', [ids]);
      const deletedSet = new Set(deletedRows.map((r) => r.id));
      const revRows = await db.all('SELECT id, admin_revision FROM domino.games WHERE id = ANY($1::text[])', [ids]);
      const adminRev = new Map(revRows.map((r) => [r.id, r.admin_revision]));
      for (const k of known) {
        if (deletedSet.has(k.id)) {
          deleted.push(k.id);
          continue;
        }
        const current = adminRev.get(k.id);
        const theirs = Number.isInteger(k.adminRevision) ? k.adminRevision : 0;
        if (current > 0 && current !== theirs) serverVersionIds.push(k.id);
      }
    }
    const serverVersions = await loadGames(db, [...new Set(serverVersionIds)]);
    res.json({ accepted, serverVersions, deleted, errors });
  });

  // ---------- Conteo de fichas con cámara ----------
  const visionLimiter = new Map();
  const VISION_WINDOW_MS = 10 * 60 * 1000;
  const VISION_MAX_REQUESTS = 30;

  app.get('/api/vision/status', auth, (req, res) => {
    res.json({ configured: visionAnalyzer.configured });
  });

  app.post('/api/vision/dominoes', auth, async (req, res) => {
    const { image, width, height, set } = req.body ?? {};
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw bad('Faltan las dimensiones de la imagen.');
    const nowMs = Date.now();
    const recent = (visionLimiter.get(req.user.id) ?? []).filter((t) => nowMs - t < VISION_WINDOW_MS);
    if (recent.length >= VISION_MAX_REQUESTS) {
      return res.status(429).json({ error: 'Demasiados análisis seguidos. Espera unos minutos.' });
    }
    recent.push(nowMs);
    visionLimiter.set(req.user.id, recent);

    // Si la app se desconecta (pantalla cerrada, cancelación), se cancela la llamada al servicio.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const result = await visionAnalyzer.analyze({ imageBase64: image, width, height, set }, { signal: controller.signal });
      res.json(result);
    } catch (err) {
      if (err instanceof VisionError) {
        if (!res.headersSent && !controller.signal.aborted) res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // ---------- Administración ----------
  const admin = express.Router();
  admin.use(...adminOnly);

  admin.get('/summary', async (req, res) => {
    const c = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM domino.players)::int AS players,
        (SELECT COUNT(*) FROM domino.players WHERE active = 1)::int AS active_players,
        (SELECT COUNT(*) FROM domino.games)::int AS games,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'pendiente')::int AS active,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'terminada')::int AS finished,
        (SELECT COUNT(*) FROM domino.games WHERE status = 'cancelada')::int AS cancelled,
        (SELECT COUNT(*) FROM domino.corrections)::int AS corrections`);
    const recent = await db.all('SELECT id FROM domino.games ORDER BY updated_at DESC LIMIT 5');
    res.json({
      players: c.players,
      activePlayers: c.active_players,
      games: c.games,
      active: c.active,
      finished: c.finished,
      cancelled: c.cancelled,
      corrections: c.corrections,
      recentGames: await loadGames(db, recent.map((r) => r.id)),
    });
  });

  // Jugadores
  admin.get('/players', async (req, res) => {
    const rows = await db.all(`${playerStatsSql} GROUP BY p.id ORDER BY lower(p.name)`);
    res.json({ players: rows.map(withPct) });
  });

  admin.get('/players/:id', async (req, res) => {
    const id = toId(req.params.id);
    const row = id && (await db.get(`${playerStatsSql} WHERE p.id = $1 GROUP BY p.id`, [id]));
    if (!row) throw notFound('El jugador no existe.');
    const ids = await db.all(
      `SELECT g.id FROM domino.game_players gp JOIN domino.games g ON g.id = gp.game_id
       WHERE gp.player_id = $1 ORDER BY g.created_at DESC LIMIT 100`,
      [row.id],
    );
    res.json({ player: withPct(row), games: await loadGames(db, ids.map((r) => r.id)) });
  });

  admin.post('/players', async (req, res) => {
    const name = cleanName(req.body?.name);
    if (await playerByName(db, name)) throw new HttpError(409, 'Ya existe un jugador con ese nombre.');
    const id = await db.tx(async (t) => {
      const created = await t.get(
        'INSERT INTO domino.players (name, active, created_at) VALUES ($1, 1, $2) RETURNING id',
        [name, now()],
      );
      await logCorrection(t, req, { entity: 'jugador', entityId: created.id, action: 'crear', reason: 'Alta de jugador', after: { name } });
      return created.id;
    });
    res.status(201).json({ player: { id, name, active: true } });
  });

  admin.patch('/players/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    const player = id && (await playerById(db, id));
    if (!player) throw notFound('El jugador no existe.');
    const after = { name: player.name, active: !!player.active };
    if (req.body.name !== undefined) after.name = cleanName(req.body.name);
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') throw bad('Estado de jugador inválido.');
      after.active = req.body.active;
    }
    const clash = await playerByName(db, after.name);
    if (clash && clash.id !== player.id) throw new HttpError(409, 'Ya existe un jugador con ese nombre.');
    await db.tx(async (t) => {
      await t.run('UPDATE domino.players SET name = $1, active = $2 WHERE id = $3', [after.name, after.active ? 1 : 0, player.id]);
      if (after.name !== player.name) {
        // Mantener coherentes los nombres guardados en las partidas.
        const games = await t.all(
          `SELECT g.* FROM domino.game_players gp JOIN domino.games g ON g.id = gp.game_id
           WHERE gp.player_id = $1 FOR UPDATE OF g`,
          [player.id],
        );
        const oldKey = player.name.toLowerCase();
        for (const row of games) {
          const participants = JSON.parse(row.participants_json).map((p) =>
            p.name.toLowerCase() === oldKey ? { ...p, name: after.name } : p,
          );
          const sides = JSON.parse(row.sides_json);
          const renamedSides =
            row.mode === 'individual' ? sides.map((s) => (s.name.toLowerCase() === oldKey ? { ...s, name: after.name } : s)) : sides;
          await t.run(
            `UPDATE domino.games SET participants_json = $1, sides_json = $2, revision = revision + 1,
                                     admin_revision = revision + 1, updated_at = $3 WHERE id = $4`,
            [JSON.stringify(participants), JSON.stringify(renamedSides), now(), row.id],
          );
        }
      }
      await logCorrection(t, req, {
        entity: 'jugador',
        entityId: player.id,
        action: 'editar',
        reason,
        before: { name: player.name, active: !!player.active },
        after,
      });
    });
    res.json({ player: { id: player.id, ...after } });
  });

  admin.delete('/players/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const id = toId(req.params.id);
    const player = id && (await playerById(db, id));
    if (!player) throw notFound('El jugador no existe.');
    const { n: used } = await db.get('SELECT COUNT(*)::int AS n FROM domino.game_players WHERE player_id = $1', [player.id]);
    if (used > 0) {
      throw new HttpError(
        409,
        `No se puede eliminar: participa en ${used} partida(s). Desactívalo para conservar el historial.`,
      );
    }
    await db.tx(async (t) => {
      await t.run('DELETE FROM domino.players WHERE id = $1', [player.id]);
      await logCorrection(t, req, { entity: 'jugador', entityId: player.id, action: 'eliminar', reason, before: { name: player.name } });
    });
    res.status(204).end();
  });

  // Partidas
  admin.get('/games', async (req, res) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (STATUSES.includes(req.query.status)) add('g.status = ?', req.query.status);
    if (typeof req.query.player === 'string' && req.query.player.trim()) {
      add(
        `EXISTS (SELECT 1 FROM domino.game_players gp JOIN domino.players p ON p.id = gp.player_id
                 WHERE gp.game_id = g.id AND p.name ILIKE ? ESCAPE '\\')`,
        `%${req.query.player.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      );
    }
    if (typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) {
      add('substr(g.created_at, 1, 10) >= ?', req.query.from);
    }
    if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      add('substr(g.created_at, 1, 10) <= ?', req.query.to);
    }
    const rows = await db.all(
      `SELECT g.id FROM domino.games g ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.created_at DESC LIMIT 300`,
      params,
    );
    res.json({ games: await loadGames(db, rows.map((r) => r.id)) });
  });

  admin.get('/games/:id', async (req, res) => {
    const game = await requireGame(db, req.params.id);
    const corrections = (await db.all('SELECT * FROM domino.corrections WHERE game_id = $1 ORDER BY id DESC', [game.id])).map(
      correctionRow,
    );
    res.json({ game, corrections });
  });

  /** Ejecuta un cambio administrativo sobre una partida con la fila bloqueada durante la transacción. */
  async function withLockedGame(id, fn) {
    return db.tx(async (t) => {
      await t.get('SELECT id FROM domino.games WHERE id = $1 FOR UPDATE', [id]);
      const game = await requireGame(t, id);
      return fn(t, game);
    });
  }

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

  admin.patch('/games/:id', async (req, res) => {
    const reason = requireReason(req.body);
    const status = req.body?.status;
    if (status !== 'cancelada' && status !== 'pendiente') {
      throw bad('Solo puedes cancelar una partida o reabrirla.');
    }
    const id = await withLockedGame(req.params.id, async (t, game) => {
      if (status === game.status) throw bad('La partida ya tiene ese estado.');
      // Reabrir recalcula el estado real (si alguien ya alcanzó la meta, vuelve a quedar terminada).
      const result = await saveAdminChange(t, { ...game, status });
      await logCorrection(t, req, {
        entity: 'partida',
        entityId: game.id,
        gameId: game.id,
        action: status === 'cancelada' ? 'cancelar' : 'reabrir',
        reason,
        before: { status: game.status },
        after: { status: result.status },
      });
      return game.id;
    });
    res.json({ game: await loadGame(db, id) });
  });

  admin.delete('/games/:id', async (req, res) => {
    const reason = requireReason(req.body);
    await withLockedGame(req.params.id, async (t, game) => {
      await t.run('DELETE FROM domino.games WHERE id = $1', [game.id]);
      await t.run(
        'INSERT INTO domino.deleted_games (id, deleted_at) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET deleted_at = excluded.deleted_at',
        [game.id, now()],
      );
      await logCorrection(t, req, { entity: 'partida', entityId: game.id, gameId: game.id, action: 'eliminar', reason, before: game });
    });
    res.status(204).end();
  });

  admin.get('/ranking', async (req, res) => {
    const rows = (await db.all(`${playerStatsSql} GROUP BY p.id HAVING COUNT(g.id) > 0`)).map(withPct);
    rows.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || a.name.localeCompare(b.name));
    res.json({ ranking: rows.map((r, i) => ({ position: i + 1, ...r })) });
  });

  function correctionRow(r) {
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

  admin.get('/corrections', async (req, res) => {
    const rows = await db.all('SELECT * FROM domino.corrections ORDER BY id DESC LIMIT 500');
    res.json({ corrections: rows.map(correctionRow) });
  });

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
    const modes = body.modes ?? {};
    if (typeof modes.individual !== 'boolean' || typeof modes.parejas !== 'boolean') throw bad('Modalidades inválidas.');
    if (!modes.individual && !modes.parejas) throw bad('Debe haber al menos una modalidad habilitada.');
    const settings = { ...DEFAULT_SETTINGS, defaultTargets: uniqueTargets, defaultTarget, modes };
    await db.tx(async (t) => {
      const before = await getSettings(t);
      await saveSettings(t, settings);
      await logCorrection(t, req, {
        entity: 'configuracion',
        entityId: 'juego',
        action: 'editar',
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : 'Actualización de configuración',
        before,
        after: settings,
      });
    });
    res.json({ settings });
  });

  // Usuarios del sistema
  admin.get('/users', async (req, res) => {
    res.json({ users: (await db.all('SELECT * FROM domino.users ORDER BY lower(username)')).map(publicUser) });
  });

  admin.post('/users', async (req, res) => {
    const username = cleanName(req.body?.username, 'El usuario');
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'anotador') throw bad('Rol inválido.');
    const weak = validatePasswordStrength(req.body?.password);
    if (weak) throw bad(weak);
    if (await userByName(db, username)) throw new HttpError(409, 'Ese usuario ya existe.');
    const user = await db.tx(async (t) => {
      const created = await t.get(
        'INSERT INTO domino.users (username, password_hash, role, active, created_at) VALUES ($1, $2, $3, 1, $4) RETURNING *',
        [username, hashPassword(req.body.password), role, now()],
      );
      await logCorrection(t, req, { entity: 'usuario', entityId: created.id, action: 'crear', reason: 'Alta de usuario', after: publicUser(created) });
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
    let { role, active, password_hash } = user;
    if (req.body.role !== undefined) {
      if (req.body.role !== 'admin' && req.body.role !== 'anotador') throw bad('Rol inválido.');
      if (isSelf && req.body.role !== 'admin') throw bad('No puedes quitarte tu propio rol de administrador.');
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
    const updated = await db.tx(async (t) => {
      const row = await t.get(
        `UPDATE domino.users SET role = $1, active = $2, password_hash = $3, token_version = token_version + 1
         WHERE id = $4 RETURNING *`,
        [role, active, password_hash, user.id],
      );
      await logCorrection(t, req, {
        entity: 'usuario',
        entityId: user.id,
        action: 'editar',
        reason,
        before: publicUser(user),
        after: { ...publicUser(row), passwordChanged: req.body.password !== undefined },
      });
      return row;
    });
    res.json({ user: publicUser(updated) });
  });

  app.use('/api/admin', admin);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande.' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
