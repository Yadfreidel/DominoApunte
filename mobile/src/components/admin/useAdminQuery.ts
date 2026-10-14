import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/state/AppStore';

interface Result<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/** Consulta autenticada al panel. `loading` es true mientras la respuesta no corresponde a la petición actual. */
export function useAdminQuery<T>(path: string | null) {
  const { api } = useStore();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const key = `${path}#${nonce}`;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path).then(
      (data) => alive && setResult({ key, data, error: null }),
      (err) =>
        alive &&
        setResult((prev) => ({
          key,
          data: prev?.data ?? null,
          error: err instanceof Error ? err.message : 'No se pudo cargar la información.',
        })),
    );
    return () => {
      alive = false;
    };
  }, [api, path, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => setResult({ key, data, error: null }), [key]);

  return {
    data: result?.data ?? null,
    error: result?.key === key ? result.error : null,
    loading: !!path && result?.key !== key,
    reload,
    setData,
  };
}
