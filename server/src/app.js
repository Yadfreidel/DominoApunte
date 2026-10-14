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
import { DEFAULT_SETTINGS, getSettings, saveSettings, transaction } from './db.js';
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
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    gameRow: db.prepare('SELECT * FROM games WHERE id = ?'),
    handsOf: db.prepare('SELECT * FROM hands WHERE game_id = ? ORDER BY seq'),
    playerByName: db.prepare('SELECT * FROM players WHERE name = ?'),
    playerById: db.prepare('SELECT * FROM players WHERE id = ?'),
    insertPlayer: db.prepare('INSERT INTO players (name, active, created_at) VALUES (?, 1, ?)'),
    insertCorrection: db.prepare(
      `INSERT INTO corrections (created_at, admin_user_id, admin_username, entity, entity_id, game_id, action, reason, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  };

  function logCorrection(req, { entity, entityId, gameId = null, action, reason, before = null, after = null }) {
    q.insertCorrection.run(
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
    );
  }

  function handRowToHand(h) {
    return { id: h.id, sideId: h.side_id, points: h.points, createdAt: h.created_at, editedAt: h.edited_at };
  }

  function loadGame(id) {
    const row = q.gameRow.get(id);
    if (!row) return null;
    const hands = q.handsOf.all(id).map(handRowToHand);
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

  function requireGame(id) {
    const game = loadGame(id);
    if (!game) throw notFound('La partida no existe.');
    return game;
  }

  function ensurePlayer(name) {
    const existing = q.playerByName.get(name);
    if (existing) return existing.id;
    return Number(q.insertPlayer.run(name, now()).lastInsertRowid);
  }

  /** Guarda la partida completa (cabecera, manos y vínculos con jugadores). */
  function writeGame(game, { adminRevision, sourceUserId }) {
    db.prepare(
      `INSERT INTO games (id, created_at, updated_at, finished_at, status, mode, target, participants_json, sides_json,
                          winner_side_id, rematch_of, revision, admin_revision, source_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at, finished_at = excluded.finished_at, status = excluded.status,
         mode = excluded.mode, target = excluded.target, participants_json = excluded.participants_json,
         sides_json = excluded.sides_json, winner_side_id = excluded.winner_side_id, rematch_of = excluded.rematch_of,
         revision = excluded.revision, admin_revision = excluded.admin_revision`,
    ).run(
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
    );
    db.prepare('DELETE FROM hands WHERE game_id = ?').run(game.id);
    const insertHand = db.prepare(
      'INSERT INTO hands (id, game_id, seq, side_id, points, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    game.hands.forEach((h, i) =>
      insertHand.run(h.id, game.id, i, h.sideId, h.points, h.createdAt, h.editedAt ?? null),
    );
    db.prepare('DELETE FROM game_players WHERE game_id = ?').run(game.id);
    const link = db.prepare('INSERT OR IGNORE INTO game_players (game_id, player_id, side_id) VALUES (?, ?, ?)');
    for (const side of game.sides) {
      for (const pid of side.participantIds) {
        const participant = game.participants.find((p) => p.id === pid);
        if (participant) link.run(game.id, ensurePlayer(participant.name), side.id);
      }
    }
  }

  /** Aplica un cambio administrativo a una partida: recalcula, bloquea la sincronización y sube la revisión. */
  function saveAdminChange(game) {
    const updated = recompute(game, game.hands, now());
    updated.updatedAt = now();
    updated.revision = game.revision + 1;
    writeGame(updated, { adminRevision: updated.revision });
    return updated;
  }

  const playerStatsSql = `
    SELECT p.id, p.name, p.active, p.created_at,
      COUNT(g.id) AS played,
      COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id = gp.side_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN g.status = 'terminada' AND g.winner_side_id <> gp.side_id THEN 1 ELSE 0 END), 0) AS losses,
      COALESCE(SUM(CASE WHEN g.status = 'pendiente' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN g.status = 'cancelada' THEN 1 ELSE 0 END), 0) AS cancelled,
      COALESCE(SUM((SELECT COALESCE(SUM(h.points), 0) FROM hands h WHERE h.game_id = g.id AND h.side_id = gp.side_id)), 0) AS points
    FROM players p
    LEFT JOIN game_players gp ON gp.player_id = p.id
    LEFT JOIN games g ON g.id = gp.game_id`;

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

  app.post('/api/auth/login', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) throw bad('Ingresa usuario y contraseña.');
    if (limiter.isBlocked(req, username)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
    }
    const user = q.userByName.get(username);
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

  app.get('/api/settings', auth, (req, res) => res.json({ settings: getSettings(db) }));

  app.post('/api/sync/games', auth, (req, res) => {
    const incoming = req.body?.games;
    if (!Array.isArray(incoming) || incoming.length > 200) throw bad('Envía entre 0 y 200 partidas.');
    const accepted = [];
    const serverVersions = [];
    const deleted = [];
    const errors = [];
    const isDeleted = db.prepare('SELECT 1 FROM deleted_games WHERE id = ?');
    for (const raw of incoming) {
      let game;
      try {
        game = validateIncomingGame(raw);
      } catch (err) {
        errors.push({ id: typeof raw?.id === 'string' ? raw.id.slice(0, 64) : null, error: err.message });
        continue;
      }
      if (isDeleted.get(game.id)) {
        deleted.push(game.id);
        continue;
      }
      const existing = q.gameRow.get(game.id);
      if (existing && existing.admin_revision > 0 && game.adminRevision !== existing.admin_revision) {
        // Un administrador corrigió esta partida y el dispositivo aún no tiene esa corrección:
        // el servidor manda y el dispositivo debe adoptar su versión.
        serverVersions.push(loadGame(game.id));
        continue;
      }
      if (existing && existing.revision >= game.revision) {
        accepted.push({ id: game.id, revision: existing.revision });
        continue;
      }
      const normalized = recompute(game, game.hands, game.updatedAt);
      transaction(db, () => writeGame(normalized, { adminRevision: existing?.admin_revision ?? 0, sourceUserId: req.user.id }));
      accepted.push({ id: game.id, revision: game.revision });
    }

    // Partidas que el dispositivo ya tenía sincronizadas: se le avisa si un administrador
    // las corrigió o eliminó desde entonces.
    const known = Array.isArray(req.body?.known) ? req.body.known.slice(0, 2000) : [];
    for (const k of known) {
      if (!ID_RE.test(k?.id ?? '')) continue;
      const adminRevision = Number.isInteger(k.adminRevision) ? k.adminRevision : 0;
      if (isDeleted.get(k.id)) {
        deleted.push(k.id);
        continue;
      }
      const existing = q.gameRow.get(k.id);
      if (existing && existing.admin_revision > 0 && existing.admin_revision !== adminRevision) {
        serverVersions.push(loadGame(k.id));
      }
    }
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
    const now = Date.now();
    const recent = (visionLimiter.get(req.user.id) ?? []).filter((t) => now - t < VISION_WINDOW_MS);
    if (recent.length >= VISION_MAX_REQUESTS) {
      return res.status(429).json({ error: 'Demasiados análisis seguidos. Espera unos minutos.' });
    }
    recent.push(now);
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

  admin.get('/summary', (req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      players: count('SELECT COUNT(*) AS n FROM players'),
      activePlayers: count('SELECT COUNT(*) AS n FROM players WHERE active = 1'),
      games: count('SELECT COUNT(*) AS n FROM games'),
      active: count("SELECT COUNT(*) AS n FROM games WHERE status = 'pendiente'"),
      finished: count("SELECT COUNT(*) AS n FROM games WHERE status = 'terminada'"),
      cancelled: count("SELECT COUNT(*) AS n FROM games WHERE status = 'cancelada'"),
      corrections: count('SELECT COUNT(*) AS n FROM corrections'),
      recentGames: db
        .prepare('SELECT id FROM games ORDER BY updated_at DESC LIMIT 5')
        .all()
        .map((r) => loadGame(r.id)),
    });
  });

  // Jugadores
  admin.get('/players', (req, res) => {
    const rows = db.prepare(`${playerStatsSql} GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all();
    res.json({ players: rows.map(withPct) });
  });

  admin.get('/players/:id', (req, res) => {
    const row = db.prepare(`${playerStatsSql} WHERE p.id = ? GROUP BY p.id`).get(Number(req.params.id));
    if (!row) throw notFound('El jugador no existe.');
    const games = db
      .prepare(
        `SELECT g.id FROM game_players gp JOIN games g ON g.id = gp.game_id
         WHERE gp.player_id = ? ORDER BY g.created_at DESC LIMIT 100`,
      )
      .all(row.id)
      .map((r) => loadGame(r.id));
    res.json({ player: withPct(row), games });
  });

  admin.post('/players', (req, res) => {
    const name = cleanName(req.body?.name);
    if (q.playerByName.get(name)) throw new HttpError(409, 'Ya existe un jugador con ese nombre.');
    const id = Number(q.insertPlayer.run(name, now()).lastInsertRowid);
    logCorrection(req, { entity: 'jugador', entityId: id, action: 'crear', reason: 'Alta de jugador', after: { name } });
    res.status(201).json({ player: { id, name, active: true } });
  });

  admin.patch('/players/:id', (req, res) => {
    const reason = requireReason(req.body);
    const player = q.playerById.get(Number(req.params.id));
    if (!player) throw notFound('El jugador no existe.');
    const after = { name: player.name, active: !!player.active };
    if (req.body.name !== undefined) after.name = cleanName(req.body.name);
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') throw bad('Estado de jugador inválido.');
      after.active = req.body.active;
    }
    const clash = q.playerByName.get(after.name);
    if (clash && clash.id !== player.id) throw new HttpError(409, 'Ya existe un jugador con ese nombre.');
    transaction(db, () => {
      db.prepare('UPDATE players SET name = ?, active = ? WHERE id = ?').run(after.name, after.active ? 1 : 0, player.id);
      if (after.name !== player.name) {
        // Mantener coherentes los nombres guardados en las partidas.
        const games = db.prepare('SELECT game_id FROM game_players WHERE player_id = ?').all(player.id);
        for (const { game_id } of games) {
          const row = q.gameRow.get(game_id);
          const participants = JSON.parse(row.participants_json).map((p) =>
            p.name.toLowerCase() === player.name.toLowerCase() ? { ...p, name: after.name } : p,
          );
          const sides = JSON.parse(row.sides_json);
          const renamedSides = row.mode === 'individual'
            ? sides.map((s) => (s.name.toLowerCase() === player.name.toLowerCase() ? { ...s, name: after.name } : s))
            : sides;
          db.prepare(
            'UPDATE games SET participants_json = ?, sides_json = ?, revision = revision + 1, admin_revision = revision + 1, updated_at = ? WHERE id = ?',
          ).run(JSON.stringify(participants), JSON.stringify(renamedSides), now(), game_id);
        }
      }
      logCorrection(req, {
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

  admin.delete('/players/:id', (req, res) => {
    const reason = requireReason(req.body);
    const player = q.playerById.get(Number(req.params.id));
    if (!player) throw notFound('El jugador no existe.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM game_players WHERE player_id = ?').get(player.id).n;
    if (used > 0) {
      throw new HttpError(
        409,
        `No se puede eliminar: participa en ${used} partida(s). Desactívalo para conservar el historial.`,
      );
    }
    transaction(db, () => {
      db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
      logCorrection(req, { entity: 'jugador', entityId: player.id, action: 'eliminar', reason, before: { name: player.name } });
    });
    res.status(204).end();
  });

  // Partidas
  admin.get('/games', (req, res) => {
    const where = [];
    const params = [];
    if (STATUSES.includes(req.query.status)) {
      where.push('g.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.player === 'string' && req.query.player.trim()) {
      where.push(
        `EXISTS (SELECT 1 FROM game_players gp JOIN players p ON p.id = gp.player_id
                 WHERE gp.game_id = g.id AND p.name LIKE ? ESCAPE '\\')`,
      );
      params.push(`%${req.query.player.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) {
      where.push('substr(g.created_at, 1, 10) >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      where.push('substr(g.created_at, 1, 10) <= ?');
      params.push(req.query.to);
    }
    const sql = `SELECT g.id FROM games g ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY g.created_at DESC LIMIT 300`;
    res.json({ games: db.prepare(sql).all(...params).map((r) => loadGame(r.id)) });
  });

  admin.get('/games/:id', (req, res) => {
    const game = requireGame(req.params.id);
    const corrections = db
      .prepare('SELECT * FROM corrections WHERE game_id = ? ORDER BY id DESC')
      .all(game.id)
      .map(correctionRow);
    res.json({ game, corrections });
  });

  admin.patch('/games/:id/hands/:handId', (req, res) => {
    const reason = requireReason(req.body);
    const points = req.body?.points;
    if (!isNonNegativeInt(points, MAX_HAND_POINTS)) {
      throw bad(`Los puntos deben ser un número entero entre 0 y ${MAX_HAND_POINTS}.`);
    }
    const game = requireGame(req.params.id);
    const hand = game.hands.find((h) => h.id === req.params.handId);
    if (!hand) throw notFound('La mano no existe.');
    const updated = transaction(db, () => {
      const result = saveAdminChange({
        ...game,
        hands: game.hands.map((h) => (h.id === hand.id ? { ...h, points, editedAt: now() } : h)),
      });
      logCorrection(req, {
        entity: 'mano',
        entityId: hand.id,
        gameId: game.id,
        action: 'editar',
        reason,
        before: { points: hand.points, status: game.status, winnerSideId: game.winnerSideId },
        after: { points, status: result.status, winnerSideId: result.winnerSideId },
      });
      return result;
    });
    res.json({ game: loadGame(updated.id) });
  });

  admin.delete('/games/:id/hands/:handId', (req, res) => {
    const reason = requireReason(req.body);
    const game = requireGame(req.params.id);
    const hand = game.hands.find((h) => h.id === req.params.handId);
    if (!hand) throw notFound('La mano no existe.');
    transaction(db, () => {
      const result = saveAdminChange({ ...game, hands: game.hands.filter((h) => h.id !== hand.id) });
      logCorrection(req, {
        entity: 'mano',
        entityId: hand.id,
        gameId: game.id,
        action: 'eliminar',
        reason,
        before: { sideId: hand.sideId, points: hand.points, status: game.status },
        after: { status: result.status, winnerSideId: result.winnerSideId },
      });
    });
    res.json({ game: loadGame(game.id) });
  });

  admin.patch('/games/:id', (req, res) => {
    const reason = requireReason(req.body);
    const game = requireGame(req.params.id);
    const status = req.body?.status;
    if (status !== 'cancelada' && status !== 'pendiente') {
      throw bad('Solo puedes cancelar una partida o reabrirla.');
    }
    if (status === game.status) throw bad('La partida ya tiene ese estado.');
    transaction(db, () => {
      // Reabrir recalcula el estado real (si alguien ya alcanzó la meta, vuelve a quedar terminada).
      const result = saveAdminChange({ ...game, status: status === 'cancelada' ? 'cancelada' : 'pendiente' });
      logCorrection(req, {
        entity: 'partida',
        entityId: game.id,
        gameId: game.id,
        action: status === 'cancelada' ? 'cancelar' : 'reabrir',
        reason,
        before: { status: game.status },
        after: { status: result.status },
      });
    });
    res.json({ game: loadGame(game.id) });
  });

  admin.delete('/games/:id', (req, res) => {
    const reason = requireReason(req.body);
    const game = requireGame(req.params.id);
    transaction(db, () => {
      db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
      db.prepare('INSERT OR REPLACE INTO deleted_games (id, deleted_at) VALUES (?, ?)').run(game.id, now());
      logCorrection(req, { entity: 'partida', entityId: game.id, gameId: game.id, action: 'eliminar', reason, before: game });
    });
    res.status(204).end();
  });

  admin.get('/ranking', (req, res) => {
    const rows = db.prepare(`${playerStatsSql} GROUP BY p.id HAVING played > 0`).all().map(withPct);
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

  admin.get('/corrections', (req, res) => {
    const rows = db.prepare('SELECT * FROM corrections ORDER BY id DESC LIMIT 500').all();
    res.json({ corrections: rows.map(correctionRow) });
  });

  admin.get('/settings', (req, res) => res.json({ settings: getSettings(db) }));

  admin.put('/settings', (req, res) => {
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
    const before = getSettings(db);
    const settings = { ...DEFAULT_SETTINGS, defaultTargets: uniqueTargets, defaultTarget, modes };
    transaction(db, () => {
      saveSettings(db, settings);
      logCorrection(req, {
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
  admin.get('/users', (req, res) => {
    res.json({ users: db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all().map(publicUser) });
  });

  admin.post('/users', (req, res) => {
    const username = cleanName(req.body?.username, 'El usuario');
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'anotador') throw bad('Rol inválido.');
    const weak = validatePasswordStrength(req.body?.password);
    if (weak) throw bad(weak);
    if (q.userByName.get(username)) throw new HttpError(409, 'Ese usuario ya existe.');
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(username, hashPassword(req.body.password), role, now());
    const user = q.userById.get(Number(info.lastInsertRowid));
    logCorrection(req, { entity: 'usuario', entityId: user.id, action: 'crear', reason: 'Alta de usuario', after: publicUser(user) });
    res.status(201).json({ user: publicUser(user) });
  });

  admin.patch('/users/:id', (req, res) => {
    const reason = requireReason(req.body);
    const user = q.userById.get(Number(req.params.id));
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
    transaction(db, () => {
      db.prepare(
        'UPDATE users SET role = ?, active = ?, password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      ).run(role, active, password_hash, user.id);
      logCorrection(req, {
        entity: 'usuario',
        entityId: user.id,
        action: 'editar',
        reason,
        before: publicUser(user),
        after: { ...publicUser({ ...user, role, active }), passwordChanged: req.body.password !== undefined },
      });
    });
    res.json({ user: publicUser(q.userById.get(user.id)) });
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
