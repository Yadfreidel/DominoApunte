import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';
import { Button, ErrorText, Field } from './ui';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Si se indica, pide un motivo obligatorio y lo devuelve. */
  reasonLabel?: string;
}

type ToastKind = 'success' | 'error' | 'info';

interface DialogApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  askReason(options: ConfirmOptions): Promise<string | null>;
  toast(message: string, kind?: ToastKind): void;
}

const DialogContext = createContext<DialogApi | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (value: string | boolean | null) => void;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ message: string; kind: ToastKind; key: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const insets = useSafeAreaInsets();

  const open = useCallback(
    (options: ConfirmOptions) =>
      new Promise<string | boolean | null>((resolve) => {
        setReason('');
        setReasonError(null);
        setPending({ ...options, resolve });
      }),
    [],
  );

  const close = (value: string | boolean | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const onConfirm = () => {
    if (!pending) return;
    if (pending.reasonLabel) {
      const r = reason.trim();
      if (r.length < 3) {
        setReasonError('Escribe el motivo (mínimo 3 caracteres).');
        return;
      }
      close(r);
    } else close(true);
  };

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    setToastState({ message, kind, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toastState) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToastState(null));
    }, toastState.kind === 'error' ? 4200 : 2400);
    return () => clearTimeout(t);
  }, [opacity, toastState]);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => open(o).then((v) => v === true),
      askReason: (o) => open({ reasonLabel: 'Motivo', ...o }).then((v) => (typeof v === 'string' ? v : null)),
      toast,
    }),
    [open, toast],
  );

  const toastColor = toastState?.kind === 'error' ? colors.danger : toastState?.kind === 'info' ? colors.purple : colors.lime;

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => close(pending?.reasonLabel ? null : false)}>
        <View style={s.backdrop}>
          <View style={s.dialog} accessibilityViewIsModal>
            <View style={[s.iconWrap, pending?.destructive && { backgroundColor: colors.dangerBg }]}>
              <Ionicons
                name={pending?.destructive ? 'warning-outline' : 'help-circle-outline'}
                size={30}
                color={pending?.destructive ? colors.danger : colors.lime}
              />
            </View>
            <Text style={s.title}>{pending?.title}</Text>
            {pending?.message ? <Text style={s.message}>{pending.message}</Text> : null}
            {pending?.reasonLabel ? (
              <View style={{ alignSelf: 'stretch' }}>
                <Field
                  label={pending.reasonLabel}
                  value={reason}
                  onChangeText={(t) => {
                    setReason(t);
                    setReasonError(null);
                  }}
                  placeholder="Ej.: se anotó 45 en lugar de 5"
                  multiline
                  maxLength={500}
                  style={{ minHeight: 80, paddingTop: 12, textAlignVertical: 'top' }}
                  autoFocus
                />
                {reasonError ? <ErrorText>{reasonError}</ErrorText> : null}
              </View>
            ) : null}
            <View style={s.actions}>
              <Button
                label={pending?.cancelLabel ?? 'Cancelar'}
                variant="outline"
                onPress={() => close(pending?.reasonLabel ? null : false)}
                style={s.action}
              />
              <Button
                label={pending?.confirmLabel ?? 'Confirmar'}
                variant={pending?.destructive ? 'danger' : 'primary'}
                onPress={onConfirm}
                style={s.action}
              />
            </View>
          </View>
        </View>
      </Modal>
      {toastState ? (
        <Animated.View
          pointerEvents="none"
          style={[s.toast, { opacity, bottom: insets.bottom + 24, borderColor: toastColor }]}
          accessibilityLiveRegion="polite"
        >
          <Ionicons
            name={toastState.kind === 'error' ? 'alert-circle' : toastState.kind === 'info' ? 'information-circle' : 'checkmark-circle'}
            size={22}
            color={toastColor}
          />
          <Text style={s.toastText}>{toastState.message}</Text>
        </Animated.View>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs debe usarse dentro de DialogProvider');
  return ctx;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.xl },
  dialog: {
    backgroundColor: colors.surfaceSolid,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24, textAlign: 'center' },
  message: { color: colors.textMuted, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  actions: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch', marginTop: space.sm },
  action: { flex: 1 },
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    alignSelf: 'center',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: 'auto',
  },
  toastText: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
});
