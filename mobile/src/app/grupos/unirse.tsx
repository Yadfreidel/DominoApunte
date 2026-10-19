import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Button, Card, EmptyState, ErrorText, Screen } from '@/components/ui';
import type { GroupSummary } from '@/domain/groups.ts';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';

/** Enlace de invitación: /grupos/unirse?codigo=XXXX-XXXX. Unirse siempre requiere confirmar. */
export default function JoinGroup() {
  const { codigo } = useLocalSearchParams<{ codigo?: string }>();
  const store = useStore();
  const goTo = useGoTo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = (codigo ?? '').toUpperCase();

  if (!store.user) {
    return (
      <Screen header={<AppHeader subtitle="Invitación a un grupo" />}>
        <EmptyState
          icon="log-in-outline"
          title="Inicia sesión para unirte"
          message={`Te invitaron a un grupo de juego (código ${code || '—'}). Inicia sesión en Configuración y vuelve a abrir el enlace, o escribe el código en Grupos.`}
          action={<Button label="Ir a Configuración" icon="log-in-outline" onPress={() => goTo('/configuracion')} />}
        />
      </Screen>
    );
  }

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await store.api<{ group: GroupSummary }>('/groups/join', { method: 'POST', body: { code } });
      router.replace({ pathname: '/grupos/[id]', params: { id: r.group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo unir al grupo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Invitación a un grupo" />}>
      <Card style={{ gap: space.md, alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontFamily: fonts.heading, fontSize: 24, textAlign: 'center' }}>Te invitaron a un grupo de juego</Text>
        <Text style={{ color: colors.lime, fontFamily: fonts.display, fontSize: 36, letterSpacing: 4 }}>{code || '—'}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>Entrarás como {store.user.username}. Podrás salir cuando quieras.</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label="Unirme al grupo" icon="enter-outline" onPress={join} loading={busy} disabled={code.replace(/[^A-Z0-9]/g, '').length !== 8} style={{ alignSelf: 'stretch' }} />
        <Button label="Ahora no" variant="ghost" size="sm" onPress={() => goTo('/grupos')} />
      </Card>
    </Screen>
  );
}
