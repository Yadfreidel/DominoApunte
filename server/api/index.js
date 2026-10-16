// Punto de entrada en Vercel (función sin servidor). Cada instancia abre la base de datos una vez
// y reutiliza la app para todas las peticiones; el esquema solo se aplica si cambió (ver db.js).
import { createApp } from '../src/app.js';
import { appOptionsFromEnv, checkSecret } from '../src/config.js';
import { openDatabase } from '../src/db.js';

let ready;

function getApp() {
  ready ??= (async () => {
    const missing = checkSecret();
    if (missing) throw new Error(missing);
    const db = await openDatabase({ url: process.env.DATABASE_URL });
    return createApp({ db, ...appOptionsFromEnv() });
  })().catch((err) => {
    ready = undefined; // se reintenta en la siguiente petición
    throw err;
  });
  return ready;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    console.error('No se pudo iniciar el servidor:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'El servidor no pudo conectarse a la base de datos. Inténtalo en unos segundos.' }));
    return;
  }
  return app(req, res);
}
