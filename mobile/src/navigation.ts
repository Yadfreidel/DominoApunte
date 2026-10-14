import { router, useRootNavigationState, type Href } from 'expo-router';

function firstSegment(href: Href): string {
  const path = typeof href === 'string' ? href : String(href.pathname);
  return path.replace(/^\//, '').split(/[/?]/)[0] || 'index';
}

/**
 * Navegación a pantallas principales (menú, botones "Volver"). Si la pantalla ya está abierta
 * más abajo en la pila, vuelve a ella en lugar de apilar una copia; si no, la abre.
 * Para pantallas de detalle (una partida, un jugador) usar router.push.
 */
export function useGoTo() {
  const state = useRootNavigationState();
  return (href: Href) => {
    const target = firstSegment(href);
    const inStack = state?.routes?.some((r) => r.name.split('/')[0] === target);
    if (inStack) router.dismissTo(href);
    else router.push(href);
  };
}

/** Vuelve a la pantalla anterior; si no hay, abre `fallback` en su lugar. */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
