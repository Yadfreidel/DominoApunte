import { Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Button, Card, EmptyState, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { goBackOr } from '@/navigation';
import { ApiError, isAdminRole, request, type User } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';

/**
 * Acceso privado al panel (/admin, sin enlaces en el menú público). Esta guardia solo decide qué
 * mostrar: la autorización real la hace el servidor, que verifica la sesión y el rol en cada
 * petición de /api/admin. No se usan contraseñas guardadas ni banderas del navegador.
 */
type GuardState = 'checking' | 'ok' | 'denied' | 'login' | 'offline';

export default function AdminLayout() {
  const store = useStore();
  const pathname = usePathname();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: Exclude<GuardState, 'checking'>; message?: string } | null>(null);
  const userId = store.user?.id;
  const { api } = store;
  const key = `${userId}#${attempt}`;
  // La pantalla para restablecer la contraseña se abre desde el correo, sin sesión.
  const isReset = pathname.startsWith('/admin/restablecer');

  useEffect(() => {
    if (userId == null || isReset) return;
    let alive = true;
    api<{ user: User }>('/auth/me').then(
      ({ user }) => alive && setResult({ key, state: isAdminRole(user.role) ? 'ok' : 'denied' }),
      (err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) setResult({ key, state: 'login' });
        else setResult({ key, state: 'offline', message: err instanceof Error ? err.message : '' });
      },
    );
    return () => {
      alive = false;
    };
  }, [api, userId, key, isReset]);

  if (isReset) return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />;

  const state: GuardState = userId == null ? 'login' : result?.key === key ? result.state : 'checking';

  if (state === 'ok') {
    return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />;
  }

  return (
    <Screen header={<AppHeader subtitle="Acceso privado" />}>
      {state === 'checking' ? <Loading label="Verificando permisos…" /> : null}
      {state === 'login' ? <AdminLogin /> : null}
      {state === 'denied' ? (
        <EmptyState
          icon="hand-left-outline"
          title="Sin permisos"
          message="Esta cuenta no es de administrador. Cierra la sesión para entrar con la cuenta del propietario o de un administrador."
          action={
            <View style={{ gap: space.sm }}>
              <Button label="Cerrar sesión y entrar con otra cuenta" icon="log-out-outline" variant="outline" onPress={() => store.logout()} />
              <Button label="Volver a la app" variant="ghost" onPress={() => goBackOr('/')} />
            </View>
          }
        />
      ) : null}
      {state === 'offline' ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Sin conexión con el servidor"
          message={`El panel necesita conexión. ${result?.message ?? ''}`}
          action={<Button label="Reintentar" icon="refresh" onPress={() => setAttempt((a) => a + 1)} />}
        />
      ) : null}
    </Screen>
  );
}

function AdminLogin() {
  const store = useStore();
  const { toast } = useDialogs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const apiUrl = store.settings.apiUrl;

  if (!apiUrl) {
    return (
      <EmptyState
        icon="server-outline"
        title="Servidor no configurado"
        message="Este dispositivo no tiene la dirección del servidor. Configúrala en Configuración → Servidor y cuenta."
        action={<Button label="Volver a la app" variant="outline" onPress={() => goBackOr('/configuracion')} />}
      />
    );
  }

  const login = async () => {
    if (busy) return;
    if (!email.trim() || !password) return setError('Escribe tu correo y contraseña.');
    setBusy(true);
    setError(null);
    try {
      const user = await store.login(email.trim(), password);
      setPassword('');
      if (!isAdminRole(user.role)) setError('Esta cuenta no tiene acceso al panel.');
      else toast('Sesión iniciada');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (busy) return;
    if (!email.trim()) return setError('Escribe el correo de tu cuenta.');
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ message: string }>(apiUrl, '/auth/forgot', { method: 'POST', body: { email: email.trim() } });
      setNotice(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md, maxWidth: 440, width: '100%', alignSelf: 'center' }}>
      <Text style={{ color: colors.text, fontFamily: fonts.heading, fontSize: 26 }}>{forgot ? 'Recuperar contraseña' : 'Panel de administración'}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 14 }}>
        {forgot
          ? 'Te enviaremos un enlace para elegir una contraseña nueva. Vence en 30 minutos y solo sirve una vez.'
          : 'Acceso exclusivo para el propietario y los administradores.'}
      </Text>
      <Field
        label="Correo"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        placeholder="tu@correo.com"
      />
      {!forgot ? (
        <Field
          label="Contraseña"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError(null);
          }}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          onSubmitEditing={login}
        />
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <Text style={{ color: colors.success, fontSize: 14 }} accessibilityLiveRegion="polite">✓ {notice}</Text> : null}
      {forgot ? (
        <>
          <Button label="Enviar enlace" icon="mail-outline" onPress={recover} loading={busy} />
          <Button label="Volver a iniciar sesión" variant="ghost" size="sm" onPress={() => { setForgot(false); setNotice(null); }} />
        </>
      ) : (
        <>
          <Button label="Entrar" icon="log-in-outline" onPress={login} loading={busy} />
          <Button label="¿Olvidaste tu contraseña?" variant="ghost" size="sm" onPress={() => { setForgot(true); setError(null); }} />
        </>
      )}
    </Card>
  );
}
