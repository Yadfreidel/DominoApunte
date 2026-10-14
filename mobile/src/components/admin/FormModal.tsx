import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';
import { Button, ErrorText, Field } from '../ui';

export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  initial?: string;
  numeric?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  destructive?: boolean;
  children?: ReactNode;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

interface Session {
  id: number;
  title: string;
  description?: string;
  fields: FormField[];
}

/** Formulario en ventana modal; onSubmit puede lanzar un error que se muestra al usuario. */
export function FormModal(props: Props) {
  const { visible, title, description, fields } = props;
  // Cada apertura es una "sesión": guarda título y campos para que el contenido no cambie
  // mientras la ventana se cierra con animación, y monta el formulario con sus valores iniciales.
  const [wasVisible, setWasVisible] = useState(visible);
  const [session, setSession] = useState<Session>({ id: 0, title, description, fields });
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSession((s) => ({ id: s.id + 1, title, description, fields }));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={s.backdrop}>
        <View style={s.dialog}>
          <FormBody
            key={session.id}
            {...props}
            title={session.title}
            description={session.description}
            fields={session.fields}
          />
        </View>
      </View>
    </Modal>
  );
}

function FormBody({ title, description, fields, submitLabel = 'Guardar', destructive, children, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{title}</Text>
      {description ? <Text style={s.description}>{description}</Text> : null}
      {fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          placeholder={f.placeholder}
          value={values[f.key] ?? ''}
          onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: f.numeric ? t.replace(/[^\d]/g, '') : t }))}
          secureTextEntry={f.secure}
          multiline={f.multiline}
          keyboardType={f.numeric ? 'number-pad' : 'default'}
          autoCapitalize={f.secure ? 'none' : 'sentences'}
          style={f.multiline ? { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' } : undefined}
        />
      ))}
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={s.actions}>
        <Button label="Cancelar" variant="outline" onPress={onClose} style={{ flex: 1 }} />
        <Button label={submitLabel} variant={destructive ? 'danger' : 'primary'} onPress={submit} loading={saving} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.lg },
  dialog: {
    backgroundColor: colors.surfaceSolid,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    alignSelf: 'center',
  },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24 },
  description: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
});
