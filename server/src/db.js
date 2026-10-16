// Acceso a la base de datos PostgreSQL.
// - Con DATABASE_URL: PostgreSQL real (Supabase u otro) mediante node-postgres.
// - Sin DATABASE_URL: PGlite (PostgreSQL embebido) en una carpeta local, para desarrollo y pruebas.
// Ambos usan exactamente el mismo SQL (sql/schema.sql), que se aplica al arrancar.
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export const SCHEMA_SQL = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');

/**
 * Valores predeterminados para nuevas partidas. Cada partida copia los suyos al crearse, así que
 * cambiarlos no modifica partidas existentes ni en curso; el usuario puede personalizarlos.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  defaultTargets: [100, 150, 200],
  defaultTarget: 200,
  defaultMode: 'individual',
  modes: { individual: true, parejas: true },
  rules: { passPoints: 0 },
});

/** Identidad visual original de la app. */
export const DEFAULT_BRANDING = Object.freeze({
  appName: 'Dominó',
  tagline: 'Marcador de partidas',
  homeText: '',
  logo: null,
});

/** Tema original ("Competitivo"). Debe coincidir con el preset "original" de mobile/src/domain/appearance.ts. */
export const DEFAULT_APPEARANCE = Object.freeze({
  preset: 'original',
  colors: {
    primary: '#C6F432',
    secondary: '#A06BFF',
    background: '#050A24',
    card: '#0E1640',
    text: '#FFFFFF',
    button: '#C6F432',
  },
});

/** Métodos comunes sobre un "ejecutor" (la base de datos o una transacción). */
function queryApi(runner, rowCount) {
  return {
    async all(sql, params = []) {
      return (await runner.query(sql, params)).rows;
    },
    async get(sql, params = []) {
      return (await runner.query(sql, params)).rows[0];
    },
    async run(sql, params = []) {
      const r = await runner.query(sql, params);
      return { rows: r.rows, rowCount: rowCount(r) };
    },
  };
}

function wrapPglite(pglite) {
  const count = (r) => r.affectedRows ?? 0;
  return {
    kind: 'pglite',
    ...queryApi(pglite, count),
    exec: (sql) => pglite.exec(sql),
    /** Ejecuta fn en una transacción; si lanza un error, se deshace todo. */
    tx: (fn) => pglite.transaction((t) => fn(queryApi(t, count))),
    close: () => pglite.close(),
  };
}

function wrapPool(pool) {
  const count = (r) => r.rowCount ?? 0;
  return {
    kind: 'postgres',
    ...queryApi(pool, count),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(queryApi(client, count));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Configuración TLS. Supabase firma sus certificados con su propia autoridad, que no está
 * en el sistema: para verificar el servidor hay que indicar su certificado raíz.
 * - DATABASE_SSL_CA=ruta/al/certificado.crt  → cifrado y servidor verificado (recomendado).
 * - DATABASE_SSL=no-verify                   → cifrado sin verificar el servidor (menos seguro).
 * - DATABASE_SSL=disable                     → sin TLS (solo bases de datos locales).
 * - sin nada                                 → cifrado verificado con las autoridades del sistema.
 */
function sslConfig(env) {
  if (env.DATABASE_SSL === 'disable') return false;
  if (env.DATABASE_SSL_CA) {
    if (!existsSync(env.DATABASE_SSL_CA)) {
      throw new Error(
        `No se encontró el certificado ${env.DATABASE_SSL_CA}. Descárgalo en Supabase (Project Settings -> Database -> SSL Configuration) y guárdalo en esa ruta.`,
      );
    }
    return { ca: readFileSync(env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  }
  if (env.DATABASE_SSL === 'no-verify') {
    console.warn('Aviso: conexión cifrada SIN verificar el certificado del servidor (DATABASE_SSL=no-verify).');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

/** La configuración TLS se toma de las variables anteriores, no de parámetros de la URL. */
function cleanUrl(url) {
  const u = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(key);
  return u.toString();
}

/**
 * Abre la base de datos y aplica el esquema.
 * @param {{ url?: string, dataDir?: string, env?: NodeJS.ProcessEnv }} options
 *   url: cadena de conexión PostgreSQL; dataDir: carpeta de PGlite, o 'memory' para una base temporal.
 */
export async function openDatabase({ url, dataDir, env = process.env } = {}) {
  let db;
  if (url) {
    const pool = new pg.Pool({
      connectionString: cleanUrl(url),
      ssl: sslConfig(env),
      max: Number(env.DATABASE_POOL_MAX || 5),
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) => console.error('Error en una conexión inactiva de la base de datos:', err.message));
    db = wrapPool(pool);
  } else {
    const pglite = dataDir === 'memory' ? new PGlite() : new PGlite(dataDir || './data/pglite');
    await pglite.waitReady;
    db = wrapPglite(pglite);
  }
  await db.exec(SCHEMA_SQL);
  return db;
}

async function readSetting(db, key, defaults) {
  const row = await db.get('SELECT value_json FROM domino.settings WHERE key = $1', [key]);
  return row ? { ...structuredClone(defaults), ...JSON.parse(row.value_json) } : structuredClone(defaults);
}

async function writeSetting(db, key, value) {
  await db.run(
    'INSERT INTO domino.settings (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json',
    [key, JSON.stringify(value)],
  );
}

export async function getSettings(db) {
  const s = await readSetting(db, 'game', DEFAULT_SETTINGS);
  // Las modalidades ya no se restringen: el usuario elige; se conserva el campo para apps anteriores.
  return { ...s, modes: { individual: true, parejas: true } };
}
export const saveSettings = (db, settings) => writeSetting(db, 'game', settings);
export const getBranding = (db) => readSetting(db, 'branding', DEFAULT_BRANDING);
export const saveBranding = (db, value) => writeSetting(db, 'branding', value);
export const getAppearance = (db) => readSetting(db, 'appearance', DEFAULT_APPEARANCE);
export const saveAppearance = (db, value) => writeSetting(db, 'appearance', value);

export async function getPublicConfig(db) {
  const [settings, branding, appearance] = await Promise.all([getSettings(db), getBranding(db), getAppearance(db)]);
  return { settings, branding, appearance };
}
