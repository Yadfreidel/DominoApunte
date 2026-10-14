import { createApp } from './app.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT || 4000);
const databasePath = process.env.DATABASE_PATH || './data/domino.db';
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  console.error('Falta JWT_SECRET (mínimo 32 caracteres). Copia .env.example como .env y complétalo.');
  process.exit(1);
}

const db = openDatabase(databasePath);
const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
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
