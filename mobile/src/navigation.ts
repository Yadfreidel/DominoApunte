import { router, useNavigationContainerRef, type Href } from 'expo-router';

function firstSegment(href: Href): string {
  const path = typeof href === 'string' ? href : String(href.pathname);
  return path.replace(/^\//, '').split(/[/?]/)[0] || 'index';
}

/**
 * Navegación a pantallas principales (menú, botones "Volver"). Si la pantalla ya está abierta
 * más abajo en la pila, vuelve a ella en lugar de apilar una copia; si no, la abre.
 * La pila se consulta en el momento de pulsar (no la del último render), para no decidir con
 * datos viejos. Para pantallas de detalle (una partida, un jugador) usar router.push.
 */
interface NavState {
  index?: number;
  routes: { name: string; state?: NavState }[];
}

/**
 * Rutas de la pila de pantallas de la app. En Expo Router la pila está anidada dentro de una ruta
 * raíz ("__root"), así que hay que bajar por la ruta enfocada hasta encontrarla.
 */
export function appStackRoutes(state: NavState | undefined): { name: string }[] {
  let current = state;
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.routes.some((r) => r.name !== '__root' && !r.name.startsWith('+'))) return current.routes;
    current = current.routes[current.index ?? 0]?.state;
  }
  return [];
}

export function useGoTo() {
  const navigation = useNavigationContainerRef();
  return (href: Href) => {
    const target = firstSegment(href);
    const routes = navigation.isReady() ? appStackRoutes(navigation.getRootState() as unknown as NavState) : [];
    const inStack = routes.some((r) => r.name.split('/')[0] === target);
    if (inStack) router.dismissTo(href);
    else router.push(href);
  };
}

/** Vuelve a la pantalla anterior; si no hay, abre `fallback` en su lugar. */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
