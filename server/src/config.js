// Opciones del servidor a partir de las variables de entorno (las usan npm start y Vercel).

export function appOptionsFromEnv(env = process.env) {
  return {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // En Vercel la petición llega a través de su proxy: la IP real del cliente viene en X-Forwarded-For
    // (necesaria para limitar los intentos de inicio de sesión por persona y no por proxy).
    trustProxy: env.VERCEL ? true : 'loopback',
  };
}

export function checkSecret(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    return 'Falta JWT_SECRET (mínimo 32 caracteres). Copia .env.example como .env y complétalo.';
  }
  return null;
}
