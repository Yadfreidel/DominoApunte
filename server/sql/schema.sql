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

-- ---------------------------------------------------------------------
-- Migración 2026-10 (idempotente, no borra datos): partidas de práctica,
-- quién sale, vínculo con torneos y tabla de torneos.
-- Las partidas anteriores quedan con practice = 0 y sin torneo.
-- ---------------------------------------------------------------------
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS practice INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS starter_participant_id TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS tournament_id TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS match_id TEXT;
CREATE INDEX IF NOT EXISTS games_tournament_idx ON domino.games (tournament_id, match_id);

-- Torneos de eliminación directa. data_json guarda participantes (jugadores o parejas fijas) y
-- el cuadro con los cruces de la primera ronda; el avance se deriva de las partidas vinculadas.
CREATE TABLE IF NOT EXISTS domino.tournaments (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  mode            TEXT    NOT NULL CHECK (mode IN ('individual', 'parejas')),
  target          INTEGER NOT NULL CHECK (target > 0),
  status          TEXT    NOT NULL CHECK (status IN ('activo', 'cancelado')),
  data_json       TEXT    NOT NULL,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 0,
  source_user_id  INTEGER REFERENCES domino.users (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- Migración 2026-11 (idempotente, no borra datos): panel de administración privado.
-- ---------------------------------------------------------------------

-- Cuentas: correo para iniciar sesión, rol de propietario y vínculo opcional con un perfil de
-- jugador (no todos los jugadores tienen cuenta).
ALTER TABLE domino.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE domino.users ADD COLUMN IF NOT EXISTS player_id INTEGER REFERENCES domino.players (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON domino.users (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE domino.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE domino.users ADD CONSTRAINT users_role_check CHECK (role IN ('propietario', 'admin', 'anotador'));

-- Foto de perfil de la cuenta (la elige cada usuario desde su perfil en la app).
ALTER TABLE domino.users ADD COLUMN IF NOT EXISTS photo TEXT;

-- Recuperación de contraseña: solo se guarda el hash del enlace, de un solo uso y con vencimiento.
CREATE TABLE IF NOT EXISTS domino.password_resets (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES domino.users (id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT
);

-- Jugadores: foto y papelera (deleted_at). Un perfil en la papelera conserva su historial.
ALTER TABLE domino.players ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE domino.players ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE domino.players ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- Nombres anteriores (renombrados o fusionados) que apuntan al perfil vigente, para que una
-- partida antigua que llegue al sincronizar no vuelva a crear el perfil duplicado.
CREATE TABLE IF NOT EXISTS domino.player_aliases (
  alias_key   TEXT    PRIMARY KEY,                  -- nombre en minúsculas
  player_id   INTEGER NOT NULL REFERENCES domino.players (id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL
);

-- Partidas: papelera y reglas opcionales elegidas al crearla (copiadas, no referenciadas: cambiar
-- los valores predeterminados no modifica partidas existentes).
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS rules_json TEXT;
CREATE INDEX IF NOT EXISTS games_deleted_idx ON domino.games (deleted_at);
CREATE INDEX IF NOT EXISTS games_source_user_idx ON domino.games (source_user_id);

-- Torneos: pausa y correcciones administrativas.
ALTER TABLE domino.tournaments ADD COLUMN IF NOT EXISTS admin_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domino.tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE domino.tournaments ADD CONSTRAINT tournaments_status_check CHECK (status IN ('activo', 'pausado', 'cancelado'));

-- Auditoría inmutable: el registro no se puede editar ni borrar (ni siquiera desde el servidor).
CREATE OR REPLACE FUNCTION domino.corrections_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría no se puede modificar ni eliminar.';
END;
$$;
DROP TRIGGER IF EXISTS corrections_inmutables ON domino.corrections;
CREATE TRIGGER corrections_inmutables BEFORE UPDATE OR DELETE ON domino.corrections
  FOR EACH ROW EXECUTE FUNCTION domino.corrections_inmutables();
CREATE INDEX IF NOT EXISTS corrections_created_idx ON domino.corrections (created_at);

-- ---------------------------------------------------------------------
-- Migración 2026-12 (idempotente, no borra datos): grupos de juego, temporadas y pantalla grande.
-- Las partidas anteriores quedan sin grupo ni temporada (no se incorporan automáticamente).
-- ---------------------------------------------------------------------

-- Grupos privados («Dominó de los viernes»). Sus integrantes son cuentas de acceso.
CREATE TABLE IF NOT EXISTS domino.groups (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  photo        TEXT,
  timezone     TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  created_by   INTEGER REFERENCES domino.users (id) ON DELETE SET NULL,
  archived_at  TEXT
);

-- Roles dentro del grupo; no dan permisos globales en la app.
CREATE TABLE IF NOT EXISTS domino.group_members (
  group_id   TEXT    NOT NULL REFERENCES domino.groups (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES domino.users (id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('propietario', 'admin', 'miembro')),
  joined_at  TEXT    NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON domino.group_members (user_id);

-- Invitaciones por código o enlace: solo se guarda el hash del código; se pueden revocar.
CREATE TABLE IF NOT EXISTS domino.group_invites (
  id          TEXT    PRIMARY KEY,
  group_id    TEXT    NOT NULL REFERENCES domino.groups (id) ON DELETE CASCADE,
  code_hash   TEXT    NOT NULL UNIQUE,
  created_by  INTEGER REFERENCES domino.users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  uses        INTEGER NOT NULL DEFAULT 0,
  max_uses    INTEGER
);
CREATE INDEX IF NOT EXISTS group_invites_group_idx ON domino.group_invites (group_id);

-- Temporadas de un grupo. La clasificación se calcula desde las partidas asociadas;
-- final_json guarda el resultado definitivo al finalizar (y se actualiza si hay correcciones).
CREATE TABLE IF NOT EXISTS domino.seasons (
  id            TEXT    PRIMARY KEY,
  group_id      TEXT    NOT NULL REFERENCES domino.groups (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  starts_on     TEXT    NOT NULL,
  ends_on       TEXT    NOT NULL,
  timezone      TEXT    NOT NULL,
  modes_json    TEXT    NOT NULL,
  ranking       TEXT    NOT NULL CHECK (ranking IN ('individual', 'parejas')),
  rules_json    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  created_by    INTEGER REFERENCES domino.users (id) ON DELETE SET NULL,
  cancelled_at  TEXT,
  finalized_at  TEXT,
  final_json    TEXT,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS seasons_group_idx ON domino.seasons (group_id);

-- Asociación explícita de cada partida con un grupo y, opcionalmente, una temporada (una sola).
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS season_id TEXT;
CREATE INDEX IF NOT EXISTS games_group_idx ON domino.games (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_season_idx ON domino.games (season_id) WHERE season_id IS NOT NULL;

-- Pantalla grande: enlaces de espectador de solo lectura para una partida (hash del token, revocables).
CREATE TABLE IF NOT EXISTS domino.spectator_links (
  token_hash  TEXT    PRIMARY KEY,
  game_id     TEXT    NOT NULL,
  created_by  INTEGER REFERENCES domino.users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS spectator_links_game_idx ON domino.spectator_links (game_id);

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
ALTER TABLE domino.tournaments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.player_aliases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.group_invites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.seasons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE domino.spectator_links ENABLE ROW LEVEL SECURITY;
