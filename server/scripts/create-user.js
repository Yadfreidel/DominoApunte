// Crea una cuenta (o restablece su contraseña) directamente en la base de datos. Es la única forma
// de asignar el rol de propietario: la app no permite registrarse ni ascender a propietario.
// Uso:  npm run set-owner -- <usuario> --email tu@correo.com
//       npm run create-admin -- <usuario> [--email correo]
//       npm run create-user -- <usuario> --role anotador [--email correo]
// La contraseña se pide por teclado (sin mostrarse). Para automatizar, usa la variable DOMINO_PASSWORD.
import { createInterface } from 'node:readline';
import { hashPassword, validatePasswordStrength } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

const ROLES = ['propietario', 'admin', 'anotador'];
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const role = option('--role') ?? 'anotador';
const email = option('--email')?.trim().toLowerCase();
const optionIdx = new Set(['--role', '--email'].flatMap((n) => (args.indexOf(n) >= 0 ? [args.indexOf(n), args.indexOf(n) + 1] : [])));
const username = args.filter((_, i) => !optionIdx.has(i))[0]?.trim();

if (!username || !ROLES.includes(role)) {
  console.error('Uso: npm run set-owner -- <usuario> --email <correo>   |   npm run create-admin -- <usuario>   |   npm run create-user -- <usuario> --role anotador');
  process.exit(1);
}
if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error('El correo no es válido.');
  process.exit(1);
}
if (role === 'propietario' && !email) {
  console.error('El propietario necesita un correo para iniciar sesión en /admin y recuperar la contraseña (--email).');
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

const db = await openDatabase({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
const existing = await db.get('SELECT id FROM domino.users WHERE lower(username) = lower($1)', [username]);
if (email) {
  const taken = await db.get('SELECT id FROM domino.users WHERE lower(email) = $1 AND id <> $2', [email, existing?.id ?? 0]);
  if (taken) {
    console.error('Ese correo ya pertenece a otra cuenta.');
    await db.close();
    process.exit(1);
  }
}
if (role === 'propietario') {
  const other = await db.get("SELECT username FROM domino.users WHERE role = 'propietario' AND id <> $1", [existing?.id ?? 0]);
  if (other) console.warn(`Aviso: "${other.username}" ya es propietario; seguirá siéndolo.`);
}
if (existing) {
  await db.run(
    `UPDATE domino.users SET password_hash = $1, role = $2, active = 1, token_version = token_version + 1,
       email = COALESCE($3, email) WHERE id = $4`,
    [hashPassword(password), role, email ?? null, existing.id],
  );
  console.log(`Usuario "${username}" actualizado (rol: ${role}). Sus sesiones anteriores quedaron cerradas.`);
} else {
  await db.run('INSERT INTO domino.users (username, email, password_hash, role, active, created_at) VALUES ($1, $2, $3, $4, 1, $5)', [
    username,
    email ?? null,
    hashPassword(password),
    role,
    new Date().toISOString(),
  ]);
  console.log(`Usuario "${username}" creado con rol ${role}.`);
}
await db.close();
