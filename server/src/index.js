import { createApp } from './app.js';
import { appOptionsFromEnv, checkSecret } from './config.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT || 4000);
const missing = checkSecret();
if (missing) {
  console.error(missing);
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

const { n: owners } = await db.get("SELECT COUNT(*)::int AS n FROM domino.users WHERE role = 'propietario' AND active = 1");
if (owners === 0) {
  console.warn('Aún no hay propietario. Asígnalo con:  npm run set-owner -- <usuario> --email <tu correo>');
}

const app = createApp({ db, ...appOptionsFromEnv() });

app.listen(port, '0.0.0.0', () => {
  console.log(`API de Dominó escuchando en http://localhost:${port}`);
});
