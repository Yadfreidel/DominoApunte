import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { KeyValueStorage } from '@/domain/repository.ts';

export const asyncStorageAdapter: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

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
