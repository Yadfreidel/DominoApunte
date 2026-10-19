import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAdminQuery } from '@/components/admin/useAdminQuery';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Disclosure } from '@/components/Disclosure';
import { Button, EmptyState, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { deviceTimeZone, GROUP_ROLE_LABEL, SEASON_STATUS_LABEL, type GroupSummary } from '@/domain/groups.ts';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

/** Grupos de juego privados de la cuenta: crear uno, unirse con un código y entrar a cada grupo. */
export default function Groups() {
  const store = useStore();
  const goTo = useGoTo();
  const { toast } = useDialogs();
  const q = useAdminQuery<{ groups: GroupSummary[] }>(store.user ? '/groups' : null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'crear' | 'unirse' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!store.user) {
    return (
      <Screen header={<AppHeader subtitle="Grupos" />}>
        <EmptyState
          icon="people-circle-outline"
          title="Grupos de juego"
          message="Los grupos (por ejemplo «Dominó de los viernes») guardan la clasificación, las temporadas y el historial entre amigos. Necesitan una cuenta: inicia sesión en Configuración. Las partidas sueltas siguen funcionando sin grupo."
          action={<Button label="Ir a Configuración" icon="log-in-outline" onPress={() => goTo('/configuracion')} />}
        />
      </Screen>
    );
  }

  const create = async () => {
    if (busy) return;
    setBusy('crear');
    setError(null);
    try {
      const r = await store.api<{ group: GroupSummary }>('/groups', { method: 'POST', body: { name, description, timezone: deviceTimeZone() } });
      toast('Grupo creado');
      setName('');
      setDescription('');
      router.push({ pathname: '/grupos/[id]', params: { id: r.group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el grupo.');
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (busy) return;
    setBusy('unirse');
    setError(null);
    try {
      const r = await store.api<{ group: GroupSummary }>('/groups/join', { method: 'POST', body: { code } });
      toast(`Te uniste a ${r.group.name}`);
      setCode('');
      router.push({ pathname: '/grupos/[id]', params: { id: r.group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo unir al grupo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Grupos" />}>
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <ErrorText>{q.error}</ErrorText> : null}
      {q.data && q.data.groups.length === 0 ? (
        <EmptyState icon="people-circle-outline" title="Todavía no estás en ningún grupo" message="Crea uno para tus amigos o únete con el código que te compartieron." />
      ) : null}
      {q.data?.groups.map((g) => {
        const active = g.seasons?.find((sn) => sn.status === 'activa');
        return (
          <Pressable
            key={g.id}
            onPress={() => router.push({ pathname: '/grupos/[id]', params: { id: g.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Grupo ${g.name}`}
            style={({ pressed }) => [s.card, pressed && { borderColor: colors.purple }]}
          >
            {g.photo ? <Image source={{ uri: g.photo }} style={s.photo} /> : <Ionicons name="people-circle" size={48} color={colors.purple} />}
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {g.name}
              </Text>
              <Text style={s.meta}>
                {g.members} {g.members === 1 ? 'integrante' : 'integrantes'} · {GROUP_ROLE_LABEL[g.myRole]}
              </Text>
              {active ? <Text style={[s.meta, { color: colors.lime }]}>Temporada: {active.name} · {SEASON_STATUS_LABEL[active.status]}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
          </Pressable>
        );
      })}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Disclosure icon="enter-outline" title="Unirme con un código" accent={colors.purple}>
        <Field label="Código de invitación" value={code} onChangeText={setCode} placeholder="Ej.: K7MQ-3XPD" autoCapitalize="characters" autoCorrect={false} maxLength={12} />
        <Button label="Unirme" icon="enter-outline" onPress={join} loading={busy === 'unirse'} disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 8} />
      </Disclosure>
      <Disclosure icon="add-circle-outline" title="Crear un grupo">
        <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej.: Dominó de los viernes" maxLength={40} />
        <Field label="Descripción (opcional)" value={description} onChangeText={setDescription} maxLength={200} />
        <Text style={s.meta}>Serás el propietario. Zona horaria: {deviceTimeZone()}.</Text>
        <Button label="Crear grupo" icon="add" onPress={create} loading={busy === 'crear'} disabled={!name.trim()} />
      </Disclosure>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
  },
  photo: { width: 48, height: 48, borderRadius: 24 },
  name: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  meta: { color: colors.textMuted, fontSize: 13 },
});
