// Errores HTTP y validaciones comunes de entrada.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);
export const notFound = (message) => new HttpError(404, message);

export const STATUSES = ['pendiente', 'terminada', 'cancelada'];
export const MODES = ['individual', 'parejas'];
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 40;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function cleanName(value, field = 'El nombre') {
  if (typeof value !== 'string') throw bad(`${field} es obligatorio.`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw bad(`${field} es obligatorio.`);
  if (name.length > MAX_NAME) throw bad(`${field} no puede superar ${MAX_NAME} caracteres.`);
  return name;
}

export function cleanEmail(value) {
  if (typeof value !== 'string') throw bad('El correo es obligatorio.');
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad('Escribe un correo válido.');
  return email;
}

export function requireReason(body) {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) throw bad('Indica el motivo de la corrección (mínimo 3 caracteres).');
  if (reason.length > 500) throw bad('El motivo no puede superar 500 caracteres.');
  return reason;
}

