// Color e icono de cada estado de un reto (lista y detalle).
import type { ChallengeState } from '@/domain/challenge.ts';
import { colors } from '@/theme';

export const STATE_STYLE: Record<ChallengeState, { color: string; icon: 'time-outline' | 'trophy-outline' | 'close-circle-outline' | 'calendar-outline' | 'flag-outline' }> = {
  programado: { color: colors.textMuted, icon: 'calendar-outline' },
  activo: { color: colors.warning, icon: 'flag-outline' },
  completado: { color: colors.lime, icon: 'trophy-outline' },
  cerrado: { color: colors.lime, icon: 'trophy-outline' },
  cancelado: { color: colors.danger, icon: 'close-circle-outline' },
};
