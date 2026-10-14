import { createApp } from './app.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  console.error('Falta JWT_SECRET (mínimo 32 caracteres). Copia .env.example como .env y complétalo.');
  process.exit(1);
}

let db;
try {
  db = await openDatabase({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
} catch (err) {
  console.error('No se pudo abrir la base de datos:', err.message);
  if (/certificate/i.test(err.message)) {
    console.error('Configura DATABASE_SSL_CA con el certificado de Supabase (ver README, sección Supabase).');
  }
  process.exit(1);
}
console.log(
  db.kind === 'postgres'
    ? 'Base de datos: PostgreSQL (DATABASE_URL)'
    : `Base de datos: PGlite local en ${process.env.PGLITE_DIR || './data/pglite'}`,
);

const { n: admins } = await db.get("SELECT COUNT(*)::int AS n FROM domino.users WHERE role = 'admin' AND active = 1");
if (admins === 0) {
  console.warn('Aún no hay administradores. Crea uno con:  npm run create-admin -- <usuario>');
}

const app = createApp({
  db,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API de Dominó escuchando en http://localhost:${port}`);
});
