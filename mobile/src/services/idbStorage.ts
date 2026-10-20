// Almacenamiento persistente para la web y la app instalada (PWA): IndexedDB.
// - Cada escritura se confirma cuando la transacción termina en disco (durability: 'strict'); solo
//   entonces la app muestra la acción como guardada.
// - Esquema versionado (DB_VERSION). La primera vez copia, en la misma transacción de creación, los
//   datos que la app guardaba antes en localStorage (claves «domino:v1:…»), así nadie pierde partidas
//   al actualizar. Las copias antiguas se conservan sin usarse (por si hubiera que volver atrás).
// - Si IndexedDB no está disponible (algunos modos privados), se informa y se usa localStorage.
import type { KeyValueStorage } from '@/domain/repository.ts';

const DB_NAME = 'domino';
const STORE = 'kv';
/** Versión del esquema local. Subirla requiere una migración en onupgradeneeded que conserve los datos. */
export const DB_VERSION = 1;
const LEGACY_PREFIX = 'domino:v1:';

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        const store = db.createObjectStore(STORE);
        // Migración desde localStorage (versiones anteriores de la app).
        try {
          const ls = globalThis.localStorage;
          for (let i = 0; ls && i < ls.length; i++) {
            const key = ls.key(i);
            if (key?.startsWith(LEGACY_PREFIX)) {
              const value = ls.getItem(key);
              if (value != null) store.put(value, key);
            }
          }
          store.put(new Date().toISOString(), `${LEGACY_PREFIX}migratedFromLocalStorage`);
        } catch {
          // Sin acceso a localStorage: no hay nada que migrar.
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña actualiza el esquema, se cierra esta conexión para no bloquearla.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB.'));
    req.onblocked = () => reject(new Error('IndexedDB está bloqueado por otra pestaña.'));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = (db.transaction as (n: string, m: IDBTransactionMode, o?: { durability: string }) => IDBTransaction)(STORE, mode, {
            durability: 'strict',
          });
        } catch {
          tx = db.transaction(STORE, mode);
        }
        let result: T | undefined;
        const req = op(tx.objectStore(STORE));
        if (req) req.onsuccess = () => (result = req.result);
        // Se resuelve al completarse la transacción: los datos ya están escritos.
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar en este dispositivo.'));
        tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar en este dispositivo (¿espacio lleno?).'));
      }),
  );
}

export const idbStorage: KeyValueStorage = {
  async getItem(key) {
    const v = await run<unknown>('readonly', (s) => s.get(key));
    return typeof v === 'string' ? v : null;
  },
  async setItem(key, value) {
    await run('readwrite', (s) => {
      s.put(value, key);
    });
  },
  async removeItem(key) {
    await run('readwrite', (s) => {
      s.delete(key);
    });
  },
};

export function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && !!indexedDB;
  } catch {
    return false;
  }
}

/** Abre la base local para comprobar que funciona (lanza si no). */
export async function checkIndexedDb(): Promise<void> {
  await openDb();
}

/** Pide al navegador que no borre los datos de la app para liberar espacio. Devuelve si lo concedió. */
export async function requestPersistence(): Promise<boolean> {
  try {
    const sm = (globalThis.navigator as Navigator | undefined)?.storage;
    if (!sm?.persist) return false;
    if (await sm.persisted?.()) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}
