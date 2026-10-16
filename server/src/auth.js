import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Hash usado cuando el usuario no existe, para que el tiempo de respuesta no revele usuarios válidos.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = (stored ?? DUMMY_HASH).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_PARAMS);
  return timingSafeEqual(actual, expected) && stored != null;
}

export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

export function signToken(user, secret, expiresIn) {
  return jwt.sign({ sub: String(user.id), tv: user.token_version }, secret, {
    algorithm: 'HS256',
    expiresIn,
  });
}

export const ADMIN_ROLES = ['propietario', 'admin'];
export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

/** Datos de la cuenta que se pueden enviar a la app (nunca el hash de la contraseña). */
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    role: user.role,
    active: !!user.active,
    playerId: user.player_id ?? null,
  };
}

/**
 * Verifica el token y vuelve a cargar el usuario desde la base de datos en cada petición,
 * de modo que desactivar un usuario, cambiarle el rol o la contraseña tenga efecto inmediato.
 */
export function authenticate(db, secret) {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer (.+)$/i.exec(header);
    if (!match) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    let payload;
    try {
      payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'La sesión expiró o no es válida. Inicia sesión de nuevo.' });
    }
    const id = Number(payload.sub);
    const user = Number.isInteger(id) ? await db.get('SELECT * FROM domino.users WHERE id = $1', [id]) : undefined;
    if (!user || !user.active || user.token_version !== payload.tv) {
      return res.status(401).json({ error: 'La sesión ya no es válida. Inicia sesión de nuevo.' });
    }
    req.user = user;
    next();
  };
}

/** Permite el paso solo a los roles indicados (se comprueba en el servidor en cada petición). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
    }
    next();
  };
}

/** Limitador simple en memoria para intentos de inicio de sesión fallidos. */
export function createLoginLimiter({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  const keyOf = (req, username) => `${req.ip}|${String(username).toLowerCase()}`;
  return {
    isBlocked(req, username) {
      const entry = attempts.get(keyOf(req, username));
      if (!entry) return false;
      if (Date.now() - entry.first > windowMs) {
        attempts.delete(keyOf(req, username));
        return false;
      }
      return entry.count >= maxAttempts;
    },
    fail(req, username) {
      const key = keyOf(req, username);
      const entry = attempts.get(key);
      if (!entry || Date.now() - entry.first > windowMs) attempts.set(key, { count: 1, first: Date.now() });
      else entry.count += 1;
    },
    reset(req, username) {
      attempts.delete(keyOf(req, username));
    },
  };
}
