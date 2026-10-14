import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { ApiError, type User } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors } from '@/theme';

/**
 * Guardia del panel. Ocultar el menú no basta: aquí se vuelve a validar la sesión con el servidor,
 * y además cada endpoint de /api/admin verifica el rol en el servidor en cada petición.
 */
type GuardState = 'checking' | 'ok' | 'denied' | 'login' | 'offline';

export default function AdminLayout() {
  const store = useStore();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: Exclude<GuardState, 'checking'>; message?: string } | null>(null);
  const userId = store.user?.id;
  const { api } = store;
  const key = `${userId}#${attempt}`;

  useEffect(() => {
    if (userId == null) return;
    let alive = true;
    api<{ user: User }>('/auth/me').then(
      ({ user }) => alive && setResult({ key, state: user.role === 'admin' ? 'ok' : 'denied' }),
      (err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) setResult({ key, state: 'login' });
        else setResult({ key, state: 'offline', message: err instanceof Error ? err.message : '' });
      },
    );
    return () => {
      alive = false;
    };
  }, [api, userId, key]);

  const state: GuardState = userId == null ? 'login' : result?.key === key ? result.state : 'checking';
  const message = result?.message ?? '';

  if (state === 'ok') {
    return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />;
  }

  return (
    <Screen header={<AppHeader subtitle="Administración" />}>
      {state === 'checking' ? <Loading label="Verificando permisos…" /> : null}
      {state === 'login' ? (
        <EmptyState
          icon="lock-closed-outline"
          title="Acceso restringido"
          message="Inicia sesión con una cuenta de administrador en Configuración para entrar al panel."
          action={<Button label="Ir a Configuración" icon="log-in-outline" onPress={() => router.navigate('/configuracion')} />}
        />
      ) : null}
      {state === 'denied' ? (
        <EmptyState
          icon="hand-left-outline"
          title="Sin permisos"
          message="Tu usuario no tiene permisos de administrador."
          action={<Button label="Volver" variant="outline" onPress={() => router.navigate('/')} />}
        />
      ) : null}
      {state === 'offline' ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Sin conexión con el servidor"
          message={`El panel necesita conexión. ${message}`}
          action={<Button label="Reintentar" icon="refresh" onPress={() => setAttempt((a) => a + 1)} />}
        />
      ) : null}
    </Screen>
  );
}
