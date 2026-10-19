import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { formatDateTime } from '@/components/GameSummary';
import { Button, Card, ErrorText, Field, Label, Pill, Screen, Select } from '@/components/ui';
import { parseTarget } from '@/domain/game.ts';
import { ApiError, normalizeApiUrl, request, ROLE_LABEL } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, space } from '@/theme';

export default function SettingsScreen() {
  const store = useStore();
  const { settings, user, sync, defaults, themePending } = store;
  const { confirm, toast } = useDialogs();

  const [newTarget, setNewTarget] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  // Si la pantalla se abrió antes de leer los datos guardados, muestra la dirección en cuanto llega.
  const [savedApiUrl, setSavedApiUrl] = useState(settings.apiUrl);
  if (savedApiUrl !== settings.apiUrl) {
    setSavedApiUrl(settings.apiUrl);
    setApiUrl(settings.apiUrl);
  }
  const [testing, setTesting] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const addTarget = async () => {
    const parsed = parseTarget(newTarget);
    if (!parsed.ok) return setTargetError(parsed.error);
    if (settings.targets.includes(parsed.value)) return setTargetError('Esa meta ya está en la lista.');
    if (settings.targets.length >= 8) return setTargetError('Máximo 8 metas.');
    await store.updateSettings({ targets: [...settings.targets, parsed.value].sort((a, b) => a - b) });
    setNewTarget('');
    setTargetError(null);
  };

  const removeTarget = async (t: number) => {
    if (settings.targets.length <= 1) return toast('Debe quedar al menos una meta.', 'error');
    const ok = await confirm({ title: `¿Quitar la meta ${t}?`, confirmLabel: 'Quitar', destructive: true });
    if (!ok) return;
    const targets = settings.targets.filter((x) => x !== t);
    await store.updateSettings({ targets, defaultTarget: settings.defaultTarget === t ? targets[0] : settings.defaultTarget });
  };

  const saveServer = async () => {
    const url = normalizeApiUrl(apiUrl);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      toast('La dirección debe empezar con http:// o https://', 'error');
      return;
    }
    if (url !== settings.apiUrl && user) {
      await store.logout();
    }
    await store.updateSettings({ apiUrl: url });
    setApiUrl(url);
    if (!url) return toast('Servidor desconectado. La app sigue funcionando sin conexión.', 'info');
    setTesting(true);
    try {
      await request(url, '/health');
      toast('Conexión correcta con el servidor');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo conectar.', 'error');
    } finally {
      setTesting(false);
    }
  };

  const login = async () => {
    if (!username.trim() || !password) return setLoginError('Escribe tu correo (o usuario) y contraseña.');
    setLoggingIn(true);
    setLoginError(null);
    try {
      const u = await store.login(username.trim(), password);
      setPassword('');
      toast(`Sesión iniciada (${ROLE_LABEL[u.role].toLowerCase()})`);
    } catch (err) {
      setLoginError(err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    const ok = await confirm({
      title: '¿Cerrar sesión?',
      message: 'Las partidas siguen guardadas en este dispositivo y se sincronizarán al volver a entrar.',
      confirmLabel: 'Cerrar sesión',
    });
    if (ok) {
      await store.logout();
      toast('Sesión cerrada', 'info');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Configuración" />}>
      {store.corrupted.length ? (
        <Card accent={colors.danger}>
          <Text style={s.warn}>
            Algunos datos guardados estaban dañados y no se pudieron leer ({store.corrupted.length}). El resto de partidas se
            recuperó correctamente.
          </Text>
        </Card>
      ) : null}

      <Card style={s.section}>
        <Text style={s.title}>Partidas</Text>
        {settings.apiUrl ? (
          <View style={s.managed}>
            <Ionicons name="information-circle-outline" size={16} color={colors.purple} />
            <Text style={s.managedText}>
              Sugerencias del organizador para partidas nuevas: meta {defaults.defaultTarget}, modalidad{' '}
              {defaults.defaultMode === 'parejas' ? 'por parejas' : 'individual'}
              {defaults.passPoints ? `, ${defaults.passPoints} puntos por pase` : ''}. Puedes cambiarlas en cada partida.
            </Text>
          </View>
        ) : null}
        {themePending ? (
          <View style={s.managed}>
            <Ionicons name="color-palette-outline" size={16} color={colors.purple} />
            <Text style={s.managedText}>Hay un tema nuevo de la app. Se aplicará al volver a abrirla.</Text>
          </View>
        ) : null}
        <Select
          label="Meta predeterminada"
          value={settings.defaultTarget}
          onChange={(v) => store.updateSettings({ defaultTarget: v })}
          options={settings.targets.map((t) => ({ value: t, label: `${t} puntos` }))}
        />
        <View>
          <Label>Metas disponibles</Label>
          <View style={s.wrap}>
            {settings.targets.map((t) => (
              <Pill key={t} label={`${t}  ✕`} active={t === settings.defaultTarget} onPress={() => removeTarget(t)} />
            ))}
          </View>
          <View style={[s.wrap, { marginTop: space.sm, alignItems: 'flex-start' }]}>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Field
                  value={newTarget}
                  onChangeText={(t) => {
                    setNewTarget(t.replace(/[^\d]/g, ''));
                    setTargetError(null);
                  }}
                  placeholder="Nueva meta, ej.: 250"
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <Button label="Agregar" icon="add" variant="outline" onPress={addTarget} />
            </View>
          {targetError ? <ErrorText>{targetError}</ErrorText> : null}
        </View>
        <View style={{ gap: space.sm }}>
          <Label>Accesibilidad</Label>
          <ToggleRow
            label="Reducir movimiento (sorteos sin animación)"
            value={settings.reduceMotion}
            onChange={(v) => store.updateSettings({ reduceMotion: v })}
          />
          <ToggleRow
            label="Mantener la pantalla encendida mientras juegas"
            value={settings.keepAwake}
            onChange={(v) => store.updateSettings({ keepAwake: v })}
          />
          <ToggleRow
            label="Sonido de victoria"
            value={settings.victorySound}
            onChange={(v) => store.updateSettings({ victorySound: v })}
          />
          <Text style={s.meta}>
            La pantalla encendida depende del teléfono y del navegador: algunos (o el modo de ahorro de batería) no lo permiten, y
            entonces se apaga según su ajuste habitual.
          </Text>
        </View>
      </Card>

      <Card style={s.section}>
        <Text style={s.title}>Servidor y cuenta</Text>
        <Text style={s.meta}>
          Opcional. Sin servidor la app funciona completa en este dispositivo. Con servidor, las partidas se sincronizan y los
          administradores pueden gestionarlas.
        </Text>
        <Field
          label="Dirección del servidor"
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="https://domino.tudominio.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Button label="Guardar y probar conexión" icon="wifi" variant="outline" onPress={saveServer} loading={testing} />

        {settings.apiUrl ? (
          user ? (
            <View style={{ gap: space.md }}>
              <View style={s.userBox}>
                <Ionicons name={user.role === 'anotador' ? 'person-circle' : 'shield-checkmark'} size={30} color={user.role === 'anotador' ? colors.lime : colors.purple} />
                <View style={{ flex: 1 }}>
                  <Text style={s.userName}>{user.username}</Text>
                  <Text style={s.meta}>{ROLE_LABEL[user.role]}</Text>
                </View>
                <Button label="Salir" size="sm" variant="outline" onPress={logout} />
              </View>
              <View style={s.syncBox}>
                <Text style={s.meta}>
                  {sync.syncing
                    ? 'Sincronizando…'
                    : sync.pending
                      ? `${sync.pending} partida(s) pendientes de sincronizar`
                      : 'Todo sincronizado'}
                  {sync.lastSyncAt ? ` · última vez ${formatDateTime(sync.lastSyncAt)}` : ''}
                </Text>
                {sync.lastError ? <ErrorText>{sync.lastError}</ErrorText> : null}
                <Button label="Sincronizar ahora" icon="sync" variant="outline" size="sm" onPress={() => store.syncNow()} loading={sync.syncing} />
              </View>
            </View>
          ) : (
            <View style={{ gap: space.md }}>
              <Field label="Correo o usuario" placeholder="tu@correo.com" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textContentType="username" />
              <Field
                label="Contraseña"
                placeholder="Tu contraseña"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                onSubmitEditing={login}
              />
              {loginError ? <ErrorText>{loginError}</ErrorText> : null}
              <Button label="Iniciar sesión" icon="log-in-outline" onPress={login} loading={loggingIn} />
            </View>
          )
        ) : null}
      </Card>

      <Text style={s.footnote}>Las partidas se guardan en este dispositivo y funcionan sin conexión.</Text>
    </Screen>
  );
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={s.toggle}>
      <Text style={[s.toggleLabel, disabled && { opacity: 0.6 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.limeDeep }}
        thumbColor={value ? colors.lime : colors.thumbOff}
        accessibilityLabel={label}
      />
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: space.lg },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  meta: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  managed: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  managedText: { color: colors.purple, fontSize: 13, flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { color: colors.text, fontSize: 16, flex: 1 },
  userBox: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  userName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  syncBox: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: space.md },
  warn: { color: colors.danger, fontSize: 14 },
  footnote: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
});
