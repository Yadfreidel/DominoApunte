// Identidad visual (nombre, logo y textos) y Apariencia (tema global), con vista previa.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  contrastChecks,
  deriveTokens,
  isHex,
  PALETTE_FIELDS,
  PRESETS,
  readableOn,
  sameAppearance,
  type Appearance,
  type PaletteKey,
} from '@/domain/appearance.ts';
import type { Branding } from '@/domain/repository.ts';
import { reloadToApplyTheme, storeAppearance } from '@/services/appearance';
import { pickLogo } from '@/services/photos';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { useDialogs } from '../Dialogs';
import { Button, Card, ErrorText, Field, Label } from '../ui';
import { as, errorMessage, QueryState, SectionHeader } from './common';
import { useAdminQuery } from './useAdminQuery';

const LOGO_MAX_KB = 1024;
const dataUriKb = (uri: string) => Math.ceil(((uri.length - uri.indexOf(',') - 1) * 3) / 4 / 1024);

// ---------------------------------------------------------------- Identidad visual
export function AdminBranding() {
  const q = useAdminQuery<{ branding: Branding; defaults: Branding }>('/admin/branding');
  return (
    <View style={as.stack}>
      <SectionHeader title="Identidad visual" subtitle="Nombre, logo y textos que ve todo el mundo en la app y en los resúmenes compartidos" />
      <QueryState {...q} />
      {!q.loading && q.data ? <BrandingForm key={JSON.stringify(q.data.branding).length} saved={q.data.branding} onSaved={q.reload} /> : null}
    </View>
  );
}

function BrandingForm({ saved, onSaved }: { saved: Branding; onSaved: () => void }) {
  const { api, refreshPublicConfig } = useStore();
  const { askReason, toast } = useDialogs();
  const [draft, setDraft] = useState<Branding>(saved);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Branding>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const validate = () => {
    if (!draft.appName.trim()) return 'El nombre de la app es obligatorio.';
    if (draft.appName.trim().length > 30) return 'El nombre no puede superar 30 caracteres.';
    if (draft.tagline.length > 60) return 'El subtítulo no puede superar 60 caracteres.';
    if (draft.homeText.length > 200) return 'El texto de bienvenida no puede superar 200 caracteres.';
    if (draft.logo && dataUriKb(draft.logo) > LOGO_MAX_KB) return `El logo pesa ${dataUriKb(draft.logo)} KB; el máximo es ${LOGO_MAX_KB} KB.`;
    return null;
  };

  const chooseLogo = async () => {
    setBusy(true);
    try {
      const uri = await pickLogo();
      if (uri) {
        set({ logo: uri });
      }
    } catch (err) {
      setError(errorMessage(err, 'No se pudo cargar la imagen.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api('/admin/branding', { method: 'PUT', body: { ...draft, reason: 'Actualización de identidad visual' } });
      await refreshPublicConfig();
      toast('Identidad visual guardada');
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar.'));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const reason = await askReason({ title: '¿Restaurar el nombre, logo y textos originales?', confirmLabel: 'Restaurar' });
    if (!reason) return;
    setBusy(true);
    try {
      await api('/admin/branding', { method: 'DELETE', body: { reason } });
      await refreshPublicConfig();
      toast('Identidad original restaurada');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card style={{ gap: space.md }}>
        <Field label="Nombre de la app" value={draft.appName} onChangeText={(t) => set({ appName: t })} maxLength={30} />
        <Field label="Subtítulo" value={draft.tagline} onChangeText={(t) => set({ tagline: t })} maxLength={60} placeholder="Ej.: Liga del barrio" />
        <Field
          label="Texto de bienvenida (pantalla Nueva partida)"
          value={draft.homeText}
          onChangeText={(t) => set({ homeText: t })}
          maxLength={200}
          multiline
          style={{ minHeight: 70, paddingTop: 12, textAlignVertical: 'top' }}
        />
        <Label>Logo (cualquier imagen: se ajusta y comprime automáticamente)</Label>
        <View style={[as.wrap, { alignItems: 'center' }]}>
          {draft.logo ? <Image source={{ uri: draft.logo }} style={st.logoLarge} accessibilityLabel="Logo elegido" /> : <Text style={as.muted}>Sin logo</Text>}
          <Button label={draft.logo ? 'Cambiar logo' : 'Elegir logo'} icon="image-outline" size="sm" variant="outline" onPress={chooseLogo} loading={busy} />
          {draft.logo ? <Button label="Quitar logo" icon="trash-outline" size="sm" variant="ghost" onPress={() => set({ logo: null })} /> : null}
        </View>
      </Card>

      <Text style={as.subTitle}>Vista previa</Text>
      <View style={st.previewBox} accessible accessibilityLabel={`Vista previa: ${draft.appName}`}>
        <View style={st.previewHeader}>
          {draft.logo ? <Image source={{ uri: draft.logo }} style={st.logo} /> : null}
          <Text style={st.previewTitle} numberOfLines={1}>
            {(draft.appName.trim() || 'Sin nombre').toLocaleUpperCase('es')}
          </Text>
        </View>
        {draft.tagline ? <Text style={st.previewTagline}>{draft.tagline}</Text> : null}
        {draft.homeText ? (
          <View style={st.previewCard}>
            <Text style={st.previewText}>{draft.homeText}</Text>
          </View>
        ) : null}
      </View>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={as.wrap}>
        <Button label="Guardar" icon="save-outline" onPress={save} loading={busy} disabled={!changed} style={{ flexGrow: 1 }} />
        <Button label="Cancelar" variant="outline" onPress={() => setDraft(saved)} disabled={!changed} style={{ flexGrow: 1 }} />
        <Button label="Restaurar originales" icon="refresh" variant="ghost" onPress={restore} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- Apariencia
export function AdminAppearance() {
  const q = useAdminQuery<{ appearance: Appearance; defaults: Appearance }>('/admin/appearance');
  return (
    <View style={as.stack}>
      <SectionHeader title="Apariencia" subtitle="Tema global de la app para todas las pantallas. Solo los administradores pueden cambiarlo." />
      <QueryState {...q} />
      {!q.loading && q.data ? <AppearanceForm key={JSON.stringify(q.data.appearance)} saved={q.data.appearance} onSaved={q.reload} /> : null}
    </View>
  );
}

function AppearanceForm({ saved, onSaved }: { saved: Appearance; onSaved: () => void }) {
  const { api, refreshPublicConfig } = useStore();
  const { askReason, confirm, toast } = useDialogs();
  const [draft, setDraft] = useState<Appearance>(saved);
  const [texts, setTexts] = useState<Record<PaletteKey, string>>(saved.colors);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checks = contrastChecks(draft.colors);
  const readable = checks.every((c) => c.ok);
  const changed = !sameAppearance(draft, saved);

  const choosePreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)!;
    setDraft({ preset: id, colors: { ...preset.colors } });
    setTexts({ ...preset.colors });
    setError(null);
  };

  const setColor = (key: PaletteKey, value: string) => {
    const v = value.startsWith('#') ? value : `#${value}`;
    setTexts((t) => ({ ...t, [key]: v }));
    if (isHex(v)) setDraft((d) => ({ preset: 'personalizado', colors: { ...d.colors, [key]: v.toUpperCase() } }));
  };

  /** Guarda en el dispositivo y recarga (web) para aplicar el tema en todas las pantallas sin destellos. */
  const apply = async (appearance: Appearance) => {
    storeAppearance(appearance);
    await refreshPublicConfig();
    if (Platform.OS === 'web') {
      const ok = await confirm({ title: 'Tema guardado', message: 'La app se recargará para aplicarlo en todas las pantallas.', confirmLabel: 'Recargar ahora', cancelLabel: 'Más tarde' });
      if (ok) reloadToApplyTheme();
    } else {
      toast('Tema guardado. Se aplicará al volver a abrir la app.');
    }
  };

  const save = async () => {
    if (!readable) return setError('Corrige los contrastes marcados antes de guardar.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ appearance: Appearance }>('/admin/appearance', { method: 'PUT', body: { ...draft, reason: 'Cambio de tema' } });
      onSaved();
      await apply(r.appearance);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar.'));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const reason = await askReason({ title: '¿Restaurar el tema original?', confirmLabel: 'Restaurar' });
    if (!reason) return;
    setBusy(true);
    try {
      const r = await api<{ appearance: Appearance }>('/admin/appearance', { method: 'DELETE', body: { reason } });
      onSaved();
      await apply(r.appearance);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Label>Temas prediseñados</Label>
      <View style={as.wrap} accessibilityRole="radiogroup">
        {PRESETS.map((p) => {
          const active = draft.preset === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => choosePreset(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`Tema ${p.name}`}
              style={({ pressed }) => [st.preset, active && st.presetActive, pressed && { opacity: 0.8 }]}
            >
              <View style={[st.swatchRow, { backgroundColor: p.colors.background }]}>
                {(['primary', 'secondary', 'card', 'button'] as PaletteKey[]).map((k) => (
                  <View key={k} style={[st.swatch, { backgroundColor: p.colors[k] }]} />
                ))}
              </View>
              <Text style={[as.rowTitle, { fontSize: 14 }]}>
                {active ? '✓ ' : ''}
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ gap: space.md }}>
        <Text style={as.rowTitle}>Personalizar colores {draft.preset === 'personalizado' ? '(personalizado)' : ''}</Text>
        <View style={as.grid}>
          {PALETTE_FIELDS.map((f) => {
            const valid = isHex(texts[f.key]);
            return (
              <View key={f.key} style={st.colorField}>
                <Label>{f.label}</Label>
                <View style={st.colorRow}>
                  <View style={[st.colorDot, { backgroundColor: valid ? texts[f.key] : 'transparent' }]} />
                  <TextInput
                    value={texts[f.key]}
                    onChangeText={(t) => setColor(f.key, t.trim())}
                    maxLength={7}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel={`Color ${f.label} en formato #RRGGBB`}
                    style={[st.colorInput, !valid && { borderColor: colors.danger }]}
                  />
                </View>
                <Text style={as.muted}>{valid ? f.hint : 'Formato #RRGGBB'}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 6 }}>
        <Text style={as.rowTitle}>Contraste y legibilidad</Text>
        {checks.map((c) => (
          <View key={c.label} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Ionicons name={c.ok ? 'checkmark-circle' : 'close-circle'} size={18} color={c.ok ? colors.success : colors.danger} />
            <Text style={[as.muted, { flex: 1 }]}>
              {c.ok ? 'Correcto' : 'Insuficiente'} · {c.label}: {c.ratio.toFixed(1)}:1 (mínimo {c.min}:1)
            </Text>
          </View>
        ))}
      </Card>

      <Text style={as.subTitle}>Vista previa</Text>
      <ThemePreview appearance={draft} />

      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={as.wrap}>
        <Button label="Guardar" icon="save-outline" onPress={save} loading={busy} disabled={!changed || !readable} style={{ flexGrow: 1 }} />
        <Button
          label="Cancelar"
          variant="outline"
          disabled={!changed}
          onPress={() => {
            setDraft(saved);
            setTexts(saved.colors);
            setError(null);
          }}
          style={{ flexGrow: 1 }}
        />
        <Button label="Restaurar tema original" icon="refresh" variant="ghost" onPress={restore} />
      </View>
    </>
  );
}

/** Maqueta de la app con los colores elegidos (fondo, tarjetas, marcador, botones y un error). */
function ThemePreview({ appearance }: { appearance: Appearance }) {
  const { branding } = useStore();
  const t = deriveTokens(appearance);
  return (
    <View style={[st.previewBox, { backgroundColor: t.bg, borderColor: t.border }]} accessible accessibilityLabel="Vista previa del tema">
      <Text style={[st.previewTitle, { color: t.title }]}>{branding.appName.toLocaleUpperCase('es')}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {[t.lime, t.purple].map((c, i) => (
          <View key={c + i} style={[st.previewScore, { backgroundColor: t.surfaceSolid, borderColor: c }]}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{i ? 'Ellos' : 'Nosotros'}</Text>
            <Text style={{ color: c, fontFamily: fonts.display, fontSize: 40 }}>{i ? 85 : 120}</Text>
          </View>
        ))}
      </View>
      <View style={[st.previewCard, { backgroundColor: t.surfaceSolid, borderColor: t.border }]}>
        <Text style={{ color: t.text, fontWeight: '700' }}>Tarjeta</Text>
        <Text style={{ color: t.textMuted }}>Texto secundario de ejemplo</Text>
        <Text style={{ color: t.danger, fontWeight: '700' }}>⚠ Mensaje de error de ejemplo</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={[st.previewButton, { backgroundColor: t.button }]}>
          <Text style={{ color: readableOn(t.button), fontWeight: '800' }}>Botón principal</Text>
        </View>
        <View style={[st.previewButton, { backgroundColor: t.outlineBg, borderColor: t.borderStrong, borderWidth: 1.5 }]}>
          <Text style={{ color: t.text, fontWeight: '700' }}>Secundario</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  logo: { width: 36, height: 36, borderRadius: 8 },
  logoLarge: { width: 64, height: 64, borderRadius: 12 },
  previewBox: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  previewTitle: { color: colors.title, fontFamily: fonts.black, fontSize: 34, letterSpacing: 2, textAlign: 'center' },
  previewTagline: { color: colors.textMuted, textAlign: 'center', fontSize: 15 },
  previewCard: { backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, gap: 4 },
  previewText: { color: colors.text, fontSize: 15, textAlign: 'center' },
  previewScore: { flex: 1, borderWidth: 2, borderRadius: radius.lg, padding: space.md, alignItems: 'center' },
  previewButton: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  preset: { width: 150, borderWidth: 2, borderColor: colors.border, borderRadius: radius.lg, padding: space.sm, gap: 6, backgroundColor: colors.surface },
  presetActive: { borderColor: colors.lime },
  swatchRow: { flexDirection: 'row', gap: 4, padding: 8, borderRadius: radius.sm },
  swatch: { flex: 1, height: 22, borderRadius: 6 },
  colorField: { flexGrow: 1, flexBasis: 180, gap: 4 },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border },
  colorInput: {
    flex: 1,
    minHeight: 44,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.field,
  },
});
