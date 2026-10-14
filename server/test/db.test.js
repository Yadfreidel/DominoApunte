// Pruebas de la capa de base de datos sobre PGlite (PostgreSQL real embebido).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { getSettings, openDatabase, saveSettings } from '../src/db.js';

describe('base de datos PostgreSQL', () => {
  test('el esquema es idempotente: reabrir la misma base no falla ni borra datos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'domino-pg-'));
    try {
      let db = await openDatabase({ dataDir: dir });
      await db.run("INSERT INTO domino.players (name, active, created_at) VALUES ('Ana', 1, 'x')");
      await db.close();
      db = await openDatabase({ dataDir: dir });
      const { n } = await db.get('SELECT COUNT(*)::int AS n FROM domino.players');
      assert.equal(n, 1);
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('una transacción con error se deshace completa', async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    await assert.rejects(
      db.tx(async (t) => {
        await t.run("INSERT INTO domino.players (name, active, created_at) VALUES ('Luis', 1, 'x')");
        throw new Error('falla a mitad');
      }),
      /falla a mitad/,
    );
    const { n } = await db.get('SELECT COUNT(*)::int AS n FROM domino.players');
    assert.equal(n, 0);
    await db.close();
  });

  test('usuarios y jugadores no se duplican por mayúsculas', async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    await db.run("INSERT INTO domino.players (name, active, created_at) VALUES ('Marta', 1, 'x')");
    await assert.rejects(db.run("INSERT INTO domino.players (name, active, created_at) VALUES ('MARTA', 1, 'x')"), /duplicate key/);
    await db.run("INSERT INTO domino.users (username, password_hash, role, created_at) VALUES ('Jefa', 'h', 'admin', 'x')");
    await assert.rejects(db.run("INSERT INTO domino.users (username, password_hash, role, created_at) VALUES ('jefa', 'h', 'admin', 'x')"), /duplicate key/);
    await db.close();
  });

  test('las restricciones protegen los datos', async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    await assert.rejects(db.run("INSERT INTO domino.users (username, password_hash, role, created_at) VALUES ('x', 'h', 'jefe', 'x')"), /check/);
    await db.run(
      `INSERT INTO domino.games (id, created_at, updated_at, status, mode, target, participants_json, sides_json)
       VALUES ('g', 'x', 'x', 'pendiente', 'parejas', 100, '[]', '[]')`,
    );
    await assert.rejects(db.run("INSERT INTO domino.hands (id, game_id, seq, side_id, points, created_at) VALUES ('h', 'g', 0, 's', -5, 'x')"), /check/);
    await db.run("INSERT INTO domino.hands (id, game_id, seq, side_id, points, created_at) VALUES ('h', 'g', 0, 's', 5, 'x')");
    await db.run("DELETE FROM domino.games WHERE id = 'g'");
    const { n } = await db.get('SELECT COUNT(*)::int AS n FROM domino.hands');
    assert.equal(n, 0, 'al borrar la partida se borran sus manos');
    await db.close();
  });

  test('configuración: valores predeterminados y guardado', async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    assert.deepEqual((await getSettings(db)).defaultTargets, [100, 150, 200]);
    await saveSettings(db, { defaultTargets: [150], defaultTarget: 150, modes: { individual: true, parejas: false } });
    assert.equal((await getSettings(db)).defaultTarget, 150);
    await db.close();
  });

  test('el archivo de permisos de Supabase es válido para PostgreSQL', async () => {
    const db = await openDatabase({ dataDir: 'memory' });
    // PGlite no tiene los roles de Supabase: se crean aquí solo para validar la sintaxis del script.
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(readFileSync(new URL('../sql/supabase-permisos.sql', import.meta.url), 'utf8'));
    const { granted } = await db.get("SELECT has_schema_privilege('anon', 'domino', 'USAGE') AS granted");
    assert.equal(granted, false);
    await db.close();
  });
});
