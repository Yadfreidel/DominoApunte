// «Así se enfrentan»: presentación épica de los rivales. Cada lado entra deslizándose desde su
// costado, el VS aparece con un golpe y queda latiendo. Con «Reducir movimiento» se muestra quieto.
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { SideAvatars, type VersusSide } from './Avatar';
import { useReduceMotion } from './StarterDraw';

export function VersusShowdown({ sides }: { sides: VersusSide[] }) {
  const reduce = useReduceMotion();
  const many = sides.length > 2;
  const avatarSize = many ? 52 : 72;
  // La animación de entrada se repite cuando cambia la cantidad de lados (modalidad o jugadores).
  const [enter] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      pulse.setValue(0);
      return;
    }
    enter.setValue(0);
    const intro = Animated.timing(enter, { toValue: 1, duration: 700, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    intro.start(() => loop.start());
    return () => {
      intro.stop();
      loop.stop();
    };
  }, [enter, pulse, reduce, sides.length]);

  const slide = (i: number) => {
    const from = sides.length === 2 ? (i === 0 ? -80 : 80) : (i - (sides.length - 1) / 2) * 50;
    return {
      opacity: enter,
      transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
    };
  };
  const vsStyle = {
    opacity: enter,
    transform: [
      { scale: Animated.add(enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: [3, 0.8, 1] }), pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] })) },
      { rotate: enter.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) },
    ],
  };
  const glow = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }) };

  return (
    <View style={s.stage} accessible accessibilityLabel={`Así se enfrentan: ${sides.map((sd) => sd.name).join(' contra ')}`}>
      {/* Fondo partido en los colores de cada lado */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={sides.length === 2 ? [sideColor(0).track, 'transparent', 'transparent', sideColor(1).track] : [sideColor(0).soft, colors.scoreFade, sideColor(1).soft]}
          locations={sides.length === 2 ? [0, 0.45, 0.55, 1] : undefined}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Text style={s.title}>ASÍ SE ENFRENTAN</Text>
      <View style={s.row}>
        {sides.map((sd, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <View style={s.vsWrap}>
                <Animated.View style={[s.vsGlow, glow]} />
                <Animated.View style={vsStyle}>
                  {/* Anillo con los colores de ambos lados y centro oscuro: el VS se lee siempre */}
                  <LinearGradient colors={[colors.lime, colors.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.vs, many && s.vsSmall]}>
                    <View style={[s.vsInner, many && s.vsInnerSmall]}>
                      <Text style={[s.vsText, many && { fontSize: 16 }]}>VS</Text>
                    </View>
                  </LinearGradient>
                </Animated.View>
              </View>
            ) : null}
            <Animated.View style={[s.side, slide(i)]}>
              <View style={[s.ring, { borderColor: sideColor(i).main, shadowColor: sideColor(i).main }]}>
                <SideAvatars names={sd.members} colorIndex={i} size={avatarSize} />
              </View>
              <Text style={[s.name, { color: sideColor(i).main }, many && { fontSize: 16 }]} numberOfLines={2}>
                {sd.name}
              </Text>
              {sd.members.length > 1 && sd.members.join(' y ') !== sd.name ? (
                <Text style={s.members} numberOfLines={1}>
                  {sd.members.join(' y ')}
                </Text>
              ) : null}
            </Animated.View>
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stage: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    gap: space.md,
    overflow: 'hidden',
  },
  title: { color: colors.textMuted, fontFamily: fonts.black, fontSize: 15, letterSpacing: 3, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  side: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  ring: {
    borderWidth: 3,
    borderRadius: 999,
    padding: 3,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  name: { fontFamily: fonts.display, fontSize: 22, textAlign: 'center', letterSpacing: 0.5 },
  members: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  vsWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  vsGlow: { position: 'absolute', width: 64, height: 64, borderRadius: 32, backgroundColor: colors.lime, shadowColor: colors.lime, shadowOpacity: 1, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  vs: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  vsSmall: { width: 44, height: 44, borderRadius: 22 },
  vsInner: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  vsInnerSmall: { width: 36, height: 36, borderRadius: 18 },
  vsText: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 22,
    letterSpacing: 1,
    textShadowColor: colors.lime,
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
});
