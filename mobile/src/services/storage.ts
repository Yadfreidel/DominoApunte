import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { KeyValueStorage } from '@/domain/repository.ts';
import { checkIndexedDb, hasIndexedDb, idbStorage, requestPersistence } from './idbStorage';

export const asyncStorageAdapter: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/**
 * - nativo: base local de AsyncStorage (SQLite en Android, archivos en iOS).
 * - indexeddb: web / PWA (ver idbStorage.ts).
 * - localstorage: web sin IndexedDB (modo privado de algunos navegadores): menos espacio y el
 *   navegador puede borrarlo; se avisa en Configuración.
 */
export type StorageKind = 'nativo' | 'indexeddb' | 'localstorage';

let chosen: Promise<{ storage: KeyValueStorage; kind: StorageKind }> | null = null;

function choose() {
  if (!chosen) {
    chosen = (async () => {
      if (Platform.OS !== 'web') return { storage: asyncStorageAdapter, kind: 'nativo' as const };
      if (hasIndexedDb()) {
        try {
          await checkIndexedDb();
          void requestPersistence();
          return { storage: idbStorage, kind: 'indexeddb' as const };
        } catch {
          // IndexedDB no disponible: se sigue con localStorage.
        }
      }
      return { storage: asyncStorageAdapter, kind: 'localstorage' as const };
    })();
  }
  return chosen;
}

/** Almacenamiento de la app: elige el mejor disponible la primera vez que se usa. */
export const appStorage: KeyValueStorage = {
  getItem: async (key) => (await choose()).storage.getItem(key),
  setItem: async (key, value) => (await choose()).storage.setItem(key, value),
  removeItem: async (key) => (await choose()).storage.removeItem(key),
};

export async function storageKind(): Promise<StorageKind> {
  return (await choose()).kind;
}

const TOKEN_KEY = 'domino_session_token';

/**
 * El token de sesión se guarda en el almacén cifrado del sistema (Keychain / Keystore).
 * En la versión web se usa sessionStorage: dura mientras la pestaña esté abierta.
 */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.sessionStorage?.getItem(TOKEN_KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.sessionStorage?.setItem(TOKEN_KEY, token);
      } catch {
        // Almacenamiento no disponible (modo privado): la sesión dura solo en memoria.
      }
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.sessionStorage?.removeItem(TOKEN_KEY);
      } catch {
        // ignorado
      }
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
