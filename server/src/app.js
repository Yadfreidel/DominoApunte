import { createHash, randomBytes } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { registerAdminRoutes } from './admin.js';
import { resolveChallenge, validateIncomingChallenge } from './challenges.js';
import { registerGroupRoutes, resolveAssociation } from './groups.js';
import {
  ADMIN_ROLES,
  authenticate,
  createLoginLimiter,
  hashPassword,
  isAdminRole,
  publicUser,
  requireRole,
  signToken,
  validatePasswordStrength,
  verifyPassword,
} from './auth.js';
import { getPublicConfig, getSettings } from './db.js';
import { isNonNegativeInt, MAX_HAND_POINTS, MAX_TARGET, recompute } from './domain.js';
import { bad, cleanName, EMAIL_RE, HttpError, ID_RE, MODES, notFound, STATUSES } from './http.js';
import { createMailer } from './mail.js';
import { nextMatchId } from './tournament.js';
import { validateImage, ValidationError } from './validation.js';
import { createDominoAnalyzer, VisionError } from './vision.js';

export { nextMatchId };
const RESET_TTL_MS = 30 * 60 * 1000;
export { bad, cleanName, HttpError, notFound, requireReason } from './http.js';

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Reglas opcionales de una partida (copiadas al crearla). */
export function cleanRules(rules) {
  if (rules === undefined || rules === null) return null;
  if (typeof rules !== 'object') throw bad('Reglas inválidas.');
  const passPoints = rules.passPoints ?? 0;
  if (!isNonNegativeInt(passPoints, MAX_HAND_POINTS)) throw bad(`Los puntos por pase deben ser un entero entre 0 y ${MAX_HAND_POINTS}.`);
  return { passPoints };
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
    const out = { id: p.id, name: cleanName(p.name, 'El nombre del jugador') };
    if (p.playerId !== undefined && p.playerId !== null) {
      if (!ID_RE.test(p.playerId)) throw bad('Identificador de jugador inválido.');
      out.playerId = p.playerId;
    }
    return out;
  });
  const participantIds = new Set(participants.map((p) => p.id));
  if (participantIds.size !== participants.length) throw bad('Jugadores repetidos.');
  if (!Array.isArray(g.sides) || g.sides.length < 2 || g.sides.length > 4) throw bad('Lados inválidos.');
  const sides = g.sides.map((s) => {
    if (!ID_RE.test(s?.id ?? '')) throw bad('Lado inválido.');
    if (!Array.isArray(s.participantIds) || s.participantIds.some((id) => !participantIds.has(id))) {
      throw bad('Lado con jugadores desconocidos.');
    }
    const out = { id: s.id, name: cleanName(s.name, 'El nombre del equipo'), participantIds: [...s.participantIds] };
    if (s.entrantId !== undefined && s.entrantId !== null) {
      if (!ID_RE.test(s.entrantId)) throw bad('Participante de torneo inválido.');
      out.entrantId = s.entrantId;
    }
    return out;
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
    practice: g.practice === true,
    starterParticipantId:
      typeof g.starterParticipantId === 'string' && participantIds.has(g.starterParticipantId) ? g.starterParticipantId : null,
    tournamentId: typeof g.tournamentId === 'string' && ID_RE.test(g.tournamentId) ? g.tournamentId : null,
    matchId: typeof g.matchId === 'string' && ID_RE.test(g.matchId) ? g.matchId : null,
    rules: cleanRules(g.rules),
    groupId: typeof g.groupId === 'string' && ID_RE.test(g.groupId) ? g.groupId : null,
    seasonId: typeof g.seasonId === 'string' && ID_RE.test(g.seasonId) ? g.seasonId : null,
    challengeId: typeof g.challengeId === 'string' && ID_RE.test(g.challengeId) ? g.challengeId : null,
    // Sincronización sin conexión: revisión confirmada en la que se basa este cambio (undefined en
    // versiones anteriores de la app) e identificador del dispositivo que lo envía.
    baseRevision: g.baseRevision === undefined ? undefined : Number.isInteger(g.baseRevision) && g.baseRevision >= 0 ? g.baseRevision : null,
    deviceId: typeof g.deviceId === 'string' && ID_RE.test(g.deviceId) ? g.deviceId : null,
  };
}

export const TOURNAMENT_STATUSES = ['activo', 'pausado', 'cancelado'];

/** Valida la estructura de un torneo (de un dispositivo o del panel). Devuelve una copia normalizada. */
export function validateIncomingTournament(t) {
  if (!t || typeof t !== 'object' || !ID_RE.test(t.id ?? '')) throw bad('Torneo inválido.');
  const name = cleanName(t.name, 'El nombre del torneo');
  if (!MODES.includes(t.mode)) throw bad('Modalidad de torneo inválida.');
  if (!Number.isInteger(t.target) || t.target < 1 || t.target > MAX_TARGET) throw bad('Meta de torneo inválida.');
  if (!TOURNAMENT_STATUSES.includes(t.status)) throw bad('Estado de torneo inválido.');
  if (!isIsoDate(t.createdAt) || !isIsoDate(t.updatedAt)) throw bad('Fechas de torneo inválidas.');
  if (!Number.isInteger(t.revision) || t.revision < 0) throw bad('Revisión de torneo inválida.');
  if (!Array.isArray(t.entrants) || t.entrants.length < 2 || t.entrants.length > 64) throw bad('Participantes de torneo inválidos.');
  const size = t.mode === 'parejas' ? 2 : 1;
  const seen = new Set();
  const seenNames = new Set();
  const entrants = t.entrants.map((e) => {
    if (!ID_RE.test(e?.id ?? '') || !Array.isArray(e.players) || e.players.length !== size) throw bad('Participante de torneo inválido.');
    const players = e.players.map((p) => {
      if (!ID_RE.test(p?.playerId ?? '')) throw bad('Jugador de torneo inválido.');
      const playerName = cleanName(p.name, 'El nombre del jugador');
      if (seen.has(p.playerId) || seenNames.has(playerName.toLowerCase())) throw bad('Un jugador aparece dos veces en el torneo.');
      seen.add(p.playerId);
      seenNames.add(playerName.toLowerCase());
      return { playerId: p.playerId, name: playerName };
    });
    const entrantName = typeof e.name === 'string' ? e.name.trim().replace(/\s+/g, ' ') : '';
    if (!entrantName || entrantName.length > 80) throw bad('El nombre del participante es obligatorio (máximo 80 caracteres).');
    return { id: e.id, name: entrantName, players };
  });
  const entrantIds = new Set(entrants.map((e) => e.id));
  if (entrantIds.size !== entrants.length) throw bad('Participantes de torneo repetidos.');
  if (!Array.isArray(t.rounds) || t.rounds.length < 1 || t.rounds.length > 7) throw bad('Cuadro de torneo inválido.');
  const placed = [];
  const rounds = t.rounds.map((round, r) => {
    const expected = 2 ** (t.rounds.length - 1 - r);
    if (!Array.isArray(round) || round.length !== expected) throw bad('Cuadro de torneo inválido.');
    return round.map((m, i) => {
      if (!ID_RE.test(m?.id ?? '')) throw bad('Enfrentamiento inválido.');
      const out = { id: m.id, round: r, index: i };
      if (r === 0) {
        const slots = Array.isArray(m.slots) ? m.slots : [];
        if (slots.length !== 2 || !entrantIds.has(slots[0]) || (slots[1] !== null && !entrantIds.has(slots[1]))) {
          throw bad('Cruce de primera ronda inválido.');
        }
        placed.push(slots[0]);
        if (slots[1]) placed.push(slots[1]);
        out.slots = [slots[0], slots[1]];
      }
      return out;
    });
  });
  if (new Set(placed).size !== placed.length || placed.length !== entrants.length) throw bad('Cada participante debe estar una sola vez en el cuadro.');
  return {
    id: t.id,
    name,
    mode: t.mode,
    target: t.target,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    revision: t.revision,
    adminRevision: Number.isInteger(t.adminRevision) && t.adminRevision >= 0 ? t.adminRevision : 0,
    entrants,
    rounds,
  };
}

export function createApp({
  db,
  jwtSecret,
  jwtExpiresIn = '12h',
  corsOrigins = [],
  visionAnalyzer = createDominoAnalyzer(),
  mailer = createMailer(),
  trustProxy = 'loopback',
  /** Reloj inyectable para las pruebas (por defecto, la hora real). */
  clock = () => new Date().toISOString(),
}) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : '*', exposedHeaders: ['Content-Disposition'] }));
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
  const limiter = createLoginLimiter();
  const recoveryLimiter = createLoginLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 });
  const now = clock;
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');

  // ---------- Consultas reutilizables ----------
  // `t` es la base de datos o una transacción en curso: ambas tienen get/all/run.
  const userByLogin = (t, login) =>
    t.get('SELECT * FROM domino.users WHERE lower(username) = lower($1) OR lower(email) = lower($1) ORDER BY id LIMIT 1', [login]);
  const userById = (t, id) => t.get('SELECT * FROM domino.users WHERE id = $1', [id]);
  const playerByName = (t, name) => t.get('SELECT * FROM domino.players WHERE lower(name) = lower($1)', [name]);
  const playerById = (t, id) => t.get('SELECT * FROM domino.players WHERE id = $1', [id]);
  const toId = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
  };

  /** Registro de auditoría. Nunca incluye contraseñas, hashes ni tokens. */
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
      practice: !!row.practice,
      starterParticipantId: row.starter_participant_id ?? null,
      tournamentId: row.tournament_id ?? null,
      matchId: row.match_id ?? null,
      rules: row.rules_json ? JSON.parse(row.rules_json) : null,
      groupId: row.group_id ?? null,
      seasonId: row.season_id ?? null,
      challengeId: row.challenge_id ?? null,
      deletedAt: row.deleted_at ?? null,
      ownerUserId: row.source_user_id ?? null,
    };
  }

  /** Carga varias partidas completas con dos consultas, conservando el orden de `ids`. */
  /** true si el servidor ya tiene exactamente este estado de la partida (mismas manos y estado). */
  async function sameContent(t, game) {
    const row = await t.get('SELECT status FROM domino.games WHERE id = $1', [game.id]);
    const hands = await t.all('SELECT id, side_id, points FROM domino.hands WHERE game_id = $1 ORDER BY seq', [game.id]);
    if (!row || row.status !== game.status || hands.length !== game.hands.length) return false;
    return hands.every((h, i) => h.id === game.hands[i].id && h.side_id === game.hands[i].sideId && h.points === game.hands[i].points);
  }

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

  function rowToTournament(row) {
    const data = JSON.parse(row.data_json);
    return {
      id: row.id,
      name: row.name,
      mode: row.mode,
      target: row.target,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      adminRevision: row.admin_revision ?? 0,
      ownerUserId: row.source_user_id ?? null,
      entrants: data.entrants,
      rounds: data.rounds,
    };
  }

  /**
   * Id del perfil con ese nombre, creándolo si no existe (seguro ante altas simultáneas). Un nombre
   * anterior (renombrado o fusionado) apunta al perfil vigente para no recrear duplicados.
   */
  async function ensurePlayer(t, name) {
    const alias = await t.get('SELECT player_id FROM domino.player_aliases WHERE alias_key = lower($1)', [name]);
    if (alias) return alias.player_id;
    await t.run(
      'INSERT INTO domino.players (name, active, created_at) VALUES ($1, 1, $2) ON CONFLICT ((lower(name))) DO NOTHING',
      [name, now()],
    );
    return (await playerByName(t, name)).id;
  }

  /** Guarda la partida completa (cabecera, manos y vínculos con jugadores). Usar dentro de una transacción. */
  async function writeGame(t, game, { adminRevision, sourceUserId, deviceId = null }) {
    await t.run(
      `INSERT INTO domino.games (id, created_at, updated_at, finished_at, status, mode, target, participants_json, sides_json,
                                 winner_side_id, rematch_of, revision, admin_revision, source_user_id,
                                 practice, starter_participant_id, tournament_id, match_id, rules_json, group_id, season_id,
                                 challenge_id, last_device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (id) DO UPDATE SET
         updated_at = excluded.updated_at, finished_at = excluded.finished_at, status = excluded.status,
         mode = excluded.mode, target = excluded.target, participants_json = excluded.participants_json,
         sides_json = excluded.sides_json, winner_side_id = excluded.winner_side_id, rematch_of = excluded.rematch_of,
         revision = excluded.revision, admin_revision = excluded.admin_revision,
         practice = excluded.practice, starter_participant_id = excluded.starter_participant_id,
         tournament_id = excluded.tournament_id, match_id = excluded.match_id, rules_json = excluded.rules_json,
         last_device_id = excluded.last_device_id`,
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
        game.practice ? 1 : 0,
        game.starterParticipantId ?? null,
        game.tournamentId ?? null,
        game.matchId ?? null,
        game.rules ? JSON.stringify(game.rules) : null,
        // Grupo y temporada solo se fijan al crear la partida en el servidor (no cambian después:
        // así una partida no se cuenta en dos temporadas ni se mueve de una a otra).
        game.groupId ?? null,
        game.seasonId ?? null,
        // El reto, igual que el grupo, solo se fija al crearla: una partida cuenta en un reto como máximo.
        game.challengeId ?? null,
        deviceId,
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
    await writeGame(t, updated, { adminRevision: updated.revision, sourceUserId: game.ownerUserId });
    return updated;
  }

  /**
   * Un resultado de torneo no se puede cambiar si el enfrentamiento siguiente del cuadro ya tiene
   * una partida iniciada (misma regla que en la app: mobile/src/domain/tournament.ts).
   */
  async function assertTournamentResultEditable(t, game) {
    if (!game.tournamentId || !game.matchId) return;
    const row = await t.get('SELECT data_json FROM domino.tournaments WHERE id = $1', [game.tournamentId]);
    if (!row) return;
    const nextId = nextMatchId(JSON.parse(row.data_json).rounds, game.matchId);
    if (!nextId) return;
    const started = await t.get(
      "SELECT 1 AS x FROM domino.games WHERE tournament_id = $1 AND match_id = $2 AND status <> 'cancelada' AND deleted_at IS NULL",
      [game.tournamentId, nextId],
    );
    if (started) {
      throw new HttpError(409, 'Este resultado ya no se puede cambiar: el siguiente enfrentamiento del torneo ya empezó.');
    }
  }

  /** Ejecuta un cambio administrativo sobre una partida con la fila bloqueada durante la transacción. */
  async function withLockedGame(id, fn, { allowDeleted = false } = {}) {
    return db.tx(async (t) => {
      await t.get('SELECT id FROM domino.games WHERE id = $1 FOR UPDATE', [id]);
      const game = await requireGame(t, id);
      if (game.deletedAt && !allowDeleted) throw new HttpError(409, 'La partida está en la papelera. Restáurala antes de modificarla.');
      await assertTournamentResultEditable(t, game);
      return fn(t, game);
    });
  }

  // ---------- Públicas ----------
  app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

  /** Valores predeterminados, identidad visual y tema: públicos (no contienen datos privados). */
  app.get('/api/public/config', async (req, res) => res.json(await getPublicConfig(db)));

  app.post('/api/auth/login', async (req, res) => {
    const login = String(req.body?.email ?? req.body?.username ?? '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!login || !password) throw bad('Ingresa tu correo (o usuario) y contraseña.');
    if (limiter.isBlocked(req, login)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' });
    }
    const user = await userByLogin(db, login);
    const valid = verifyPassword(password, user?.password_hash ?? null);
    if (!user || !valid || !user.active) {
      limiter.fail(req, login);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    limiter.reset(req, login);
    res.json({ token: signToken(user, jwtSecret, jwtExpiresIn), user: publicUser(user) });
  });

  app.get('/api/auth/recovery', (req, res) => res.json({ emailConfigured: mailer.configured }));

  // La respuesta es siempre la misma, exista o no la cuenta, para no revelar qué correos están registrados.
  app.post('/api/auth/forgot', async (req, res) => {
    const generic = {
      message: mailer.configured
        ? 'Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer la contraseña.'
        : 'La recuperación por correo no está configurada en el servidor. Pide al propietario que restablezca tu contraseña.',
      emailConfigured: mailer.configured,
    };
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) throw bad('Escribe un correo válido.');
    if (!mailer.configured) return res.json(generic);
    if (recoveryLimiter.isBlocked(req, email)) return res.json(generic);
    recoveryLimiter.fail(req, email);
    const user = await db.get('SELECT * FROM domino.users WHERE lower(email) = $1 AND active = 1', [email]);
    if (user) {
      const token = randomBytes(32).toString('base64url');
      const created = now();
      await db.run(
        'INSERT INTO domino.password_resets (user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [user.id, sha256(token), created, new Date(Date.now() + RESET_TTL_MS).toISOString()],
      );
      try {
        await mailer.send({
          to: user.email,
          subject: 'Restablecer tu contraseña',
          text: `Para elegir una contraseña nueva abre este enlace (vence en 30 minutos y solo sirve una vez):\n\n${mailer.appUrl}/admin/restablecer?token=${token}\n\nSi no lo pediste, ignora este correo.`,
        });
      } catch (err) {
        console.error('No se pudo enviar el correo de recuperación:', err.message);
      }
    }
    res.json(generic);
  });

  app.post('/api/auth/reset', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw bad('El enlace no es válido.');
    const weak = validatePasswordStrength(req.body?.password);
    if (weak) throw bad(weak);
    await db.tx(async (t) => {
      const row = await t.get('SELECT * FROM domino.password_resets WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
      if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
        throw bad('El enlace venció o ya se usó. Pide uno nuevo.');
      }
      await t.run('UPDATE domino.password_resets SET used_at = $1 WHERE id = $2', [now(), row.id]);
      // Cambiar token_version cierra todas las sesiones abiertas de la cuenta.
      await t.run('UPDATE domino.users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [
        hashPassword(req.body.password),
        row.user_id,
      ]);
    });
    res.json({ ok: true });
  });

  // ---------- Usuario autenticado (anotador o administrador) ----------
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  /** Foto de perfil de la propia cuenta (cualquier usuario con sesión). null la quita. */
  app.put('/api/auth/me/photo', auth, async (req, res) => {
    const photo = req.body?.photo;
    const img = photo === null ? null : validateImage(photo, { maxBytes: 200 * 1024, minSide: 32, maxSide: 1024, label: 'La foto' });
    const row = await db.get('UPDATE domino.users SET photo = $1 WHERE id = $2 RETURNING *', [img?.dataUri ?? null, req.user.id]);
    res.json({ user: publicUser(row) });
  });

  /** Cierra todas las sesiones de la cuenta (en todos los dispositivos). */
  app.post('/api/auth/logout-all', auth, async (req, res) => {
    await db.run('UPDATE domino.users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    res.status(204).end();
  });

  app.get('/api/settings', auth, async (req, res) => res.json({ settings: await getSettings(db) }));

  app.post('/api/sync/games', auth, async (req, res) => {
    const incoming = req.body?.games;
    if (!Array.isArray(incoming) || incoming.length > 200) throw bad('Envía entre 0 y 200 partidas.');
    const incomingTournaments = req.body?.tournaments ?? [];
    if (!Array.isArray(incomingTournaments) || incomingTournaments.length > 100) throw bad('Envía como máximo 100 torneos.');
    const incomingChallenges = req.body?.challenges ?? [];
    if (!Array.isArray(incomingChallenges) || incomingChallenges.length > 100) throw bad('Envía como máximo 100 retos.');
    const isAdmin = isAdminRole(req.user.role);
    // Solo el dueño (la cuenta que la registró) modifica su partida o torneo; los administradores, cualquiera.
    const canEdit = (ownerId) => isAdmin || ownerId == null || ownerId === req.user.id;
    const accepted = [];
    const serverVersionIds = [];
    const deleted = [];
    const errors = [];
    const warnings = [];
    const acceptedTournaments = [];
    const serverTournamentIds = [];
    const acceptedChallenges = [];
    const conflicts = [];
    // Retos primero: el servidor debe conocer el reto antes de recibir sus partidas.
    for (const raw of incomingChallenges) {
      let ch;
      try {
        ch = validateIncomingChallenge(raw);
      } catch (err) {
        errors.push({ id: typeof raw?.id === 'string' ? raw.id.slice(0, 64) : null, error: err.message });
        continue;
      }
      const deviceId = typeof raw.deviceId === 'string' && ID_RE.test(raw.deviceId) ? raw.deviceId : null;
      const outcome = await db.tx(async (t) => {
        const existing = await t.get('SELECT revision, source_user_id FROM domino.challenges WHERE id = $1 FOR UPDATE', [ch.id]);
        if (existing && !canEdit(existing.source_user_id)) return 'forbidden';
        // Reenvío de una versión ya guardada (respuesta perdida, reintento): no cambia nada.
        if (existing && existing.revision >= ch.revision) return { revision: existing.revision };
        const { id, name, kind, mode, status, createdAt, updatedAt, revision, ...data } = ch;
        await t.run(
          `INSERT INTO domino.challenges (id, name, kind, mode, status, data_json, created_at, updated_at, revision, source_user_id, last_device_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, status = excluded.status, data_json = excluded.data_json,
             updated_at = excluded.updated_at, revision = excluded.revision, last_device_id = excluded.last_device_id`,
          [id, name, kind, mode, status, JSON.stringify(data), createdAt, updatedAt, revision, existing ? existing.source_user_id : req.user.id, deviceId],
        );
        return { revision };
      });
      if (outcome === 'forbidden') errors.push({ id: ch.id, error: 'No puedes modificar un reto de otra cuenta.' });
      else acceptedChallenges.push({ id: ch.id, revision: outcome.revision });
    }
    for (const raw of incomingTournaments) {
      let tour;
      try {
        tour = validateIncomingTournament(raw);
      } catch (err) {
        errors.push({ id: typeof raw?.id === 'string' ? raw.id.slice(0, 64) : null, error: err.message });
        continue;
      }
      const outcome = await db.tx(async (t) => {
        const existing = await t.get('SELECT revision, admin_revision, source_user_id FROM domino.tournaments WHERE id = $1 FOR UPDATE', [tour.id]);
        if (existing && !canEdit(existing.source_user_id)) return 'forbidden';
        if (existing && existing.admin_revision > 0 && tour.adminRevision !== existing.admin_revision) return 'server';
        if (existing && existing.revision >= tour.revision) return { revision: existing.revision };
        await t.run(
          `INSERT INTO domino.tournaments (id, name, mode, target, status, data_json, created_at, updated_at, revision, source_user_id, admin_revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, status = excluded.status, data_json = excluded.data_json,
             updated_at = excluded.updated_at, revision = excluded.revision`,
          [
            tour.id,
            tour.name,
            tour.mode,
            tour.target,
            tour.status,
            JSON.stringify({ entrants: tour.entrants, rounds: tour.rounds }),
            tour.createdAt,
            tour.updatedAt,
            tour.revision,
            req.user.id,
          ],
        );
        return { revision: tour.revision };
      });
      if (outcome === 'forbidden') errors.push({ id: tour.id, error: 'No puedes modificar un torneo organizado por otra cuenta.' });
      else if (outcome === 'server') serverTournamentIds.push(tour.id);
      else acceptedTournaments.push({ id: tour.id, revision: outcome.revision });
    }
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
        if (await t.get('SELECT 1 AS x FROM domino.deleted_games WHERE id = $1', [game.id])) return 'deleted';
        const existing = await t.get(
          'SELECT revision, admin_revision, source_user_id, deleted_at, group_id, season_id, challenge_id, last_device_id FROM domino.games WHERE id = $1 FOR UPDATE',
          [game.id],
        );
        if (existing?.deleted_at) return 'deleted';
        if (existing && !canEdit(existing.source_user_id)) return 'forbidden';
        if (!existing && game.tournamentId && !isAdmin) {
          const tour = await t.get('SELECT source_user_id FROM domino.tournaments WHERE id = $1', [game.tournamentId]);
          if (tour && !canEdit(tour.source_user_id)) return 'forbidden';
        }
        if (existing && existing.admin_revision > 0 && game.adminRevision !== existing.admin_revision) {
          // Un administrador corrigió esta partida y el dispositivo aún no tiene esa corrección:
          // el servidor manda y el dispositivo debe adoptar su versión.
          return 'server';
        }
        // Las versiones de la app con sincronización sin conexión envían la revisión base: si otro
        // dispositivo cambió la partida en el servidor desde esa revisión, es un conflicto y no se
        // sobrescribe. Un reenvío del mismo dispositivo (respuesta perdida) se acepta sin cambios.
        const modern = game.baseRevision !== undefined;
        const ownWrite = !!existing && !!game.deviceId && existing.last_device_id === game.deviceId;
        if (existing && existing.revision >= game.revision) {
          if (!modern || ownWrite) return { revision: existing.revision };
          if (existing.revision === game.revision && (await sameContent(t, game))) return { revision: existing.revision };
          return 'conflict';
        }
        if (existing && modern && !ownWrite && existing.revision !== game.baseRevision) return 'conflict';
        let warning = null;
        if (existing) {
          game.groupId = existing.group_id ?? null;
          game.seasonId = existing.season_id ?? null;
          game.challengeId = existing.challenge_id ?? null;
        } else {
          const assoc = await resolveAssociation(t, req.user, game, now());
          game.groupId = assoc.groupId;
          game.seasonId = assoc.seasonId;
          warning = assoc.warning;
          const ch = await resolveChallenge(t, req.user, game, isAdmin);
          game.challengeId = ch.challengeId;
          warning = warning ?? ch.warning;
        }
        const normalized = recompute(game, game.hands, game.updatedAt);
        await writeGame(t, normalized, {
          adminRevision: existing?.admin_revision ?? 0,
          sourceUserId: existing ? existing.source_user_id : req.user.id,
          deviceId: game.deviceId,
        });
        return { revision: game.revision, warning, groupId: game.groupId, seasonId: game.seasonId, challengeId: game.challengeId };
      });
      if (outcome?.warning) {
        warnings.push({ id: game.id, warning: outcome.warning, groupId: outcome.groupId, seasonId: outcome.seasonId, challengeId: outcome.challengeId ?? null });
      }
      if (outcome === 'conflict') {
        conflicts.push(game.id);
        serverVersionIds.push(game.id);
      } else if (outcome === 'deleted') deleted.push(game.id);
      else if (outcome === 'server') serverVersionIds.push(game.id);
      else if (outcome === 'forbidden') errors.push({ id: game.id, error: 'No puedes modificar una partida registrada por otra cuenta.' });
      else accepted.push({ id: game.id, revision: outcome.revision });
    }

    // Partidas que el dispositivo ya tenía sincronizadas: se le avisa si un administrador
    // las corrigió, las envió a la papelera o las eliminó desde entonces.
    const known = (Array.isArray(req.body?.known) ? req.body.known.slice(0, 2000) : []).filter((k) => ID_RE.test(k?.id ?? ''));
    if (known.length) {
      const ids = known.map((k) => k.id);
      const deletedRows = await db.all(
        `SELECT id FROM domino.deleted_games WHERE id = ANY($1::text[])
         UNION SELECT id FROM domino.games WHERE id = ANY($1::text[]) AND deleted_at IS NOT NULL`,
        [ids],
      );
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
    // Partidas de esta cuenta que un administrador corrigió o restauró de la papelera y que el
    // dispositivo no tiene (no las envió ni figuran entre las conocidas): se le entregan.
    if (req.body?.pull === true) {
      const have = [...known.map((k) => k.id), ...incoming.map((g) => g?.id).filter((id) => typeof id === 'string')];
      const missing = await db.all(
        `SELECT id FROM domino.games WHERE source_user_id = $1 AND admin_revision > 0 AND deleted_at IS NULL
           AND NOT (id = ANY($2::text[])) ORDER BY updated_at DESC LIMIT 200`,
        [req.user.id, have],
      );
      serverVersionIds.push(...missing.map((r) => r.id));
    }

    // Torneos: correcciones administrativas (pausa, participantes, cancelación) y torneos creados
    // desde el panel para esta cuenta.
    const knownTournaments = (Array.isArray(req.body?.knownTournaments) ? req.body.knownTournaments.slice(0, 500) : []).filter((k) =>
      ID_RE.test(k?.id ?? ''),
    );
    if (knownTournaments.length) {
      const rows = await db.all('SELECT id, admin_revision FROM domino.tournaments WHERE id = ANY($1::text[])', [knownTournaments.map((k) => k.id)]);
      const rev = new Map(rows.map((r) => [r.id, r.admin_revision]));
      for (const k of knownTournaments) {
        const current = rev.get(k.id) ?? 0;
        if (current > 0 && current !== (Number.isInteger(k.adminRevision) ? k.adminRevision : 0)) serverTournamentIds.push(k.id);
      }
    }
    if (req.body?.pull === true) {
      const have = [...knownTournaments.map((k) => k.id), ...incomingTournaments.map((x) => x?.id).filter((id) => typeof id === 'string')];
      const missing = await db.all(
        'SELECT id FROM domino.tournaments WHERE source_user_id = $1 AND admin_revision > 0 AND NOT (id = ANY($2::text[])) LIMIT 100',
        [req.user.id, have],
      );
      serverTournamentIds.push(...missing.map((r) => r.id));
    }
    const serverVersions = await loadGames(db, [...new Set(serverVersionIds)]);
    const tIds = [...new Set(serverTournamentIds)];
    const serverTournaments = tIds.length
      ? (await db.all('SELECT * FROM domino.tournaments WHERE id = ANY($1::text[])', [tIds])).map(rowToTournament)
      : [];
    res.json({ accepted, serverVersions, deleted, errors, warnings, acceptedTournaments, serverTournaments, acceptedChallenges, conflicts });
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

  // ---------- Administración (solo propietario y administradores, verificado en cada petición) ----------
  const admin = express.Router();
  admin.use(auth, requireRole(...ADMIN_ROLES));
  registerAdminRoutes(admin, {
    db,
    now,
    toId,
    userById,
    userByLogin,
    playerByName,
    playerById,
    logCorrection,
    loadGames,
    loadGame,
    requireGame,
    rowToTournament,
    ensurePlayer,
    writeGame,
    saveAdminChange,
    withLockedGame,
  });
  app.use('/api/admin', admin);

  // ---------- Grupos, temporadas y pantalla grande ----------
  registerGroupRoutes(app, { db, now, auth, loadGames });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande.' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
