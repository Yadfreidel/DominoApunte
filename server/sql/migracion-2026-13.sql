-- Migración 2026-13: retos entre amigos y sincronización sin conexión.
-- Es la misma sección que está en schema.sql (el servidor la aplica sola al arrancar). Este archivo
-- es para ejecutarla a mano en el editor SQL de Supabase si se prefiere. Es idempotente y aditiva:
-- no borra ni modifica datos existentes; las partidas anteriores quedan sin reto.

CREATE TABLE IF NOT EXISTS domino.challenges (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('primero', 'serie')),
  mode            TEXT    NOT NULL CHECK (mode IN ('individual', 'parejas')),
  status          TEXT    NOT NULL CHECK (status IN ('activo', 'cancelado')),
  data_json       TEXT    NOT NULL,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 0,
  source_user_id  INTEGER REFERENCES domino.users (id) ON DELETE SET NULL,
  last_device_id  TEXT
);
CREATE INDEX IF NOT EXISTS challenges_owner_idx ON domino.challenges (source_user_id);

ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS challenge_id TEXT;
ALTER TABLE domino.games ADD COLUMN IF NOT EXISTS last_device_id TEXT;
CREATE INDEX IF NOT EXISTS games_challenge_idx ON domino.games (challenge_id) WHERE challenge_id IS NOT NULL;

ALTER TABLE domino.challenges ENABLE ROW LEVEL SECURITY;
