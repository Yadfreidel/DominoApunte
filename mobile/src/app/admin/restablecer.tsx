import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Button, Card, EmptyState, ErrorText, Field, Screen } from '@/components/ui';
import { request } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';

/** Elegir una contraseña nueva con el enlace de un solo uso recibido por correo. */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { settings } = useStore();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (password.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (password !== repeat) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    setError(null);
    try {
      await request(settings.apiUrl, '/auth/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Restablecer contraseña" />}>
      {!token ? (
        <EmptyState icon="link-outline" title="Enlace incompleto" message="Abre el enlace completo que recibiste por correo." />
      ) : done ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Contraseña actualizada"
          message="Todas las sesiones anteriores se cerraron. Ya puedes entrar con tu contraseña nueva."
          action={<Button label="Ir al panel" icon="log-in-outline" onPress={() => router.replace('/admin')} />}
        />
      ) : (
        <Card style={{ gap: space.md, maxWidth: 440, width: '100%', alignSelf: 'center' }}>
          <Text style={{ color: colors.text, fontFamily: fonts.heading, fontSize: 24 }}>Elige una contraseña nueva</Text>
          <Field label="Contraseña nueva (mínimo 10 caracteres)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          <Field label="Repite la contraseña" value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" onSubmitEditing={submit} />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label="Guardar contraseña" icon="key-outline" onPress={submit} loading={busy} />
        </Card>
      )}
    </Screen>
  );
}
