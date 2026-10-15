-- =====================================================================
-- Base de datos de la app Dominó (PostgreSQL / Supabase)
--
-- Todas las tablas viven en el esquema privado "domino". Supabase solo
-- publica por su API REST el esquema "public", así que estas tablas no son
-- accesibles con las claves públicas del proyecto: únicamente el servidor
-- de la app, conectado con la cadena de conexión de Postgres, puede leerlas.
--
-- El servidor ejecuta este mismo script al arrancar (todo es idempotente),
-- así que crear las tablas a mano en Supabase es opcional.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS domino;

-- Usuarios del sistema: administradores y anotadores.
CREATE TABLE IF NOT EXISTS domino.users (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,                 -- scrypt$sal$clave (nunca la contraseña)
  role           TEXT    NOT NULL CHECK (role IN ('admin', 'anotador')),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  token_version  INTEGER NOT NULL DEFAULT 0,       -- al cambiarla se cierran todas sus sesiones
  created_at     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON domino.users (lower(username));

-- Jugadores (personas que juegan; no tienen cuenta).
CREATE TABLE IF NOT EXISTS domino.players (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON domino.players (lower(name));

-- Partidas. Los participantes y lados se guardan como JSON en texto.
CREATE TABLE IF NOT EXISTS domino.games (
  id                 TEXT    PRIMARY KEY,           -- generado en el dispositivo
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  finished_at        TEXT,
  status             TEXT    NOT NULL CHECK (status IN ('pendiente', 'terminada', 'cancelada')),
  mode               TEXT    NOT NULL CHECK (mode IN ('individual', 'parejas')),
  target             INTEGER NOT NULL CHECK (target > 0),
  participants_json  TEXT    NOT NULL,
  sides_json         TEXT    NOT NULL,
  winner_side_id     TEXT,
  rematch_of         TEXT,
  revision           INTEGER NOT NULL DEFAULT 0,    -- aumenta con cada cambio
  admin_revision     INTEGER NOT NULL DEFAULT 0,    -- revisión de la última corrección administrativa (0 = ninguna)
  source_user_id     INTEGER REFERENCES domino.users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS games_status_idx ON domino.games (status);
CREATE INDEX IF NOT EXISTS games_created_idx ON domino.games (created_at);
CREATE INDEX IF NOT EXISTS games_updated_idx ON domino.games (updated_at);

-- Qué jugador participó en qué partida y de qué lado.
CREATE TABLE IF NOT EXISTS domino.game_players (
  game_id    TEXT    NOT NULL REFERENCES domino.games (id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES domino.players (id) ON DELETE CASCADE,
  side_id    TEXT    NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS game_players_player_idx ON domino.game_players (player_id);

-- Manos de cada partida, en orden.
CREATE TABLE IF NOT EXISTS domino.hands (
  id          TEXT    PRIMARY KEY,                  -- generado en el dispositivo
  game_id     TEXT    NOT NULL REFERENCES domino.games (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  side_id     TEXT    NOT NULL,
  points      INTEGER NOT NULL CHECK (points >= 0),
  created_at  TEXT    NOT NULL,
  edited_at   TEXT
);
CREATE INDEX IF NOT EXISTS hands_game_idx ON domino.hands (game_id, seq);

-- Registro de correcciones administrativas (fecha, responsable, motivo, antes y después).
CREATE TABLE IF NOT EXISTS domino.corrections (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      TEXT    NOT NULL,
  admin_user_id   INTEGER,
  admin_username  TEXT    NOT NULL,
  entity          TEXT    NOT NULL,                 -- mano, partida, jugador, usuario, configuracion
  entity_id       TEXT    NOT NULL,
  game_id         TEXT,
  action          TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  before_json     TEXT,
  after_json      TEXT
);
CREATE INDEX IF NOT EXISTS corrections_game_idx ON domino.corrections (game_id);

-- Partidas eliminadas por un administrador: impide que un dispositivo las vuelva a subir.
CREATE TABLE IF NOT EXISTS domino.deleted_games (
  id          TEXT PRIMARY KEY,
  deleted_at  TEXT NOT NULL
);

-- Configuración general (metas predeterminadas y modalidades).
CREATE TABLE IF NOT EXISTS domino.settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL
);

-- Seguridad adicional: RLS activado sin políticas. El servidor se conecta como
-- dueño de las tablas y no se ve afectado; cualquier otro rol queda bloqueado.
ALTER TABLE domino.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.game_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.hands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.corrections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.deleted_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.settings      ENABLE ROW LEVEL SECURITY;
