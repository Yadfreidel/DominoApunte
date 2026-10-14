// Crea un usuario (o restablece su contraseña) directamente en la base de datos.
// Uso:  npm run create-admin -- <usuario>
//       npm run create-user -- <usuario> --role anotador
// La contraseña se pide por teclado (sin mostrarse). Para automatizar, usa la variable DOMINO_PASSWORD.
import { createInterface } from 'node:readline';
import { hashPassword, validatePasswordStrength } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

const args = process.argv.slice(2);
const roleIndex = args.indexOf('--role');
const role = roleIndex >= 0 ? args[roleIndex + 1] : 'anotador';
const username = args.filter((_, i) => roleIndex < 0 || (i !== roleIndex && i !== roleIndex + 1))[0]?.trim();

if (!username || (role !== 'admin' && role !== 'anotador')) {
  console.error('Uso: npm run create-admin -- <usuario>   |   npm run create-user -- <usuario> --role anotador');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

let password = process.env.DOMINO_PASSWORD;
if (!password) {
  password = await askHidden(`Contraseña para "${username}": `);
  const repeat = await askHidden('Repite la contraseña: ');
  if (password !== repeat) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }
}
const weak = validatePasswordStrength(password);
if (weak) {
  console.error(weak);
  process.exit(1);
}

const db = openDatabase(process.env.DATABASE_PATH || './data/domino.db');
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare(
    'UPDATE users SET password_hash = ?, role = ?, active = 1, token_version = token_version + 1 WHERE id = ?',
  ).run(hashPassword(password), role, existing.id);
  console.log(`Usuario "${username}" actualizado (rol: ${role}). Sus sesiones anteriores quedaron cerradas.`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)').run(
    username,
    hashPassword(password),
    role,
    new Date().toISOString(),
  );
  console.log(`Usuario "${username}" creado con rol ${role}.`);
}
