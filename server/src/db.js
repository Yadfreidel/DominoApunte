import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_SETTINGS = Object.freeze({
  defaultTargets: [100, 150, 200],
  defaultTarget: 200,
  modes: { individual: true, parejas: true },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'anotador')),
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'terminada', 'cancelada')),
  mode TEXT NOT NULL CHECK (mode IN ('individual', 'parejas')),
  target INTEGER NOT NULL,
  participants_json TEXT NOT NULL,
  sides_json TEXT NOT NULL,
  winner_side_id TEXT,
  rematch_of TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  -- Revisión de la última corrección administrativa (0 = nunca corregida).
  admin_revision INTEGER NOT NULL DEFAULT 0,
  source_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  side_id TEXT NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS hands (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  side_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  created_at TEXT NOT NULL,
  edited_at TEXT
);
CREATE INDEX IF NOT EXISTS hands_game ON hands(game_id, seq);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  admin_user_id INTEGER,
  admin_username TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  game_id TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);

-- Partidas eliminadas por un administrador: impide que un dispositivo las vuelva a subir.
CREATE TABLE IF NOT EXISTS deleted_games (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction; rolls back on any thrown error. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSettings(db) {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'game'").get();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  return { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(row.value_json) };
}

export function saveSettings(db, settings) {
  db.prepare(
    "INSERT INTO settings (key, value_json) VALUES ('game', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
  ).run(JSON.stringify(settings));
}
