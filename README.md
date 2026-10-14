# Dominó · Marcador de partidas

App móvil para anotar los puntos de partidas presenciales de dominó, con historial, estadísticas y un panel de administración protegido.

```
Dominos/
├── mobile/   App (React Native + Expo SDK 57 + TypeScript, Expo Router). También corre en web/escritorio.
└── server/   API opcional (Node.js + Express + SQLite) para la administración compartida y la sincronización.
```

La app funciona completa **sin servidor y sin conexión**. El servidor solo hace falta para el panel de administración, compartir partidas entre dispositivos y el ranking global.

---

## Funciones

**Partidas**
- Modalidad con dos tarjetas grandes: **Individual** (selector desplegable de 2, 3 o 4 jugadores) o **Por parejas** (2 parejas).
- En parejas basta con escribir **un nombre por pareja**. El compañero es opcional ("Agregar compañero") y el nombre del equipo se forma solo, por ejemplo "Marta y Pedro".
- **Fotos de jugadores:** al tocar el círculo de cada jugador se puede tomar una foto o elegirla de la galería; si no tiene foto, se muestran sus iniciales. La foto se recorta en cuadrado, se reduce a 256 px y queda guardada en el dispositivo con el nombre del jugador, así que aparece en todas sus partidas. Las fotos no se envían al servidor.
- Vista **"Así se enfrentan"** con las fotos o iniciales de cada lado y un "VS"; el marcador también muestra las fotos en cada tarjeta.
- Los jugadores recientes aparecen con su foto para agregarlos con un toque.
- Meta de 100, 150 o 200 puntos, o una cantidad personalizada. Todos los marcadores empiezan en cero.

**Marcador**
- Tarjetas con números grandes y barra de progreso hacia la meta. **Toda la tarjeta es el botón**: al tocar un jugador o equipo (marcado con un "+") se abre el teclado numérico con ese lado ya elegido. Nada se suma hasta pulsar **Confirmar**, y en el teclado se puede cambiar de lado si se tocó el equivocado.
- Cada mano se guarda en el dispositivo en cuanto se confirma. Si la app se cierra, al abrirla vuelve a la partida en curso.
- Para editar una mano se toca en el historial o se navega con las flechas de "Mano N"; se pueden cambiar los puntos o a quién se le anotaron.
- **Deshacer** elimina la última mano (pide confirmación). Todo cambio recalcula el marcador y el ganador.
- Sin registros duplicados: cada apertura del teclado tiene un identificador de mano único, el botón se bloquea mientras guarda y registrar una mano ya existente no tiene efecto.
- Gana el primero que alcanza o supera la meta. Desde ahí se puede jugar la revancha (mismos participantes, marcadores en cero) o empezar una partida nueva.
- Solo se aceptan números enteros no negativos (máximo 1000 por mano).

**Menú principal (☰):** Nueva partida, Partida en curso, Historial, Estadísticas, Configuración y Administración. Administración solo aparece para administradores, pero eso no es la protección real (ver [Seguridad](#seguridad)).

**Historial**
- Guarda la fecha, los participantes, la modalidad, la meta, el resultado y el detalle de cada mano.
- Filtros por fecha (hoy, 7 días, 30 días o un rango), por jugador y por estado: pendiente, terminada o cancelada.
- El detalle es de **solo lectura**: no hay controles para modificar resultados.

**Panel de administración** (adaptable: barra lateral en escritorio, pestañas en móvil)
- Inicio con indicadores de jugadores, partidas, partidas activas, terminadas, canceladas y correcciones.
- Jugadores: alta, renombrar, desactivar o eliminar, y sus estadísticas.
- Partidas: filtros, historial de manos, corrección o eliminación de manos, y cancelar, reabrir o eliminar partidas.
- Ranking por partidas ganadas, con victorias, derrotas y porcentaje de victorias.
- Registro de correcciones con fecha, motivo y responsable. Toda modificación pide un motivo obligatorio.
- Configuración de las metas predeterminadas y las modalidades que se envían a todos los dispositivos.
- Usuarios: crear administradores o anotadores, cambiar rol o contraseña, y desactivar cuentas.
- Toda eliminación pide confirmación explícita.

---

## Requisitos

- **Node.js 22.13 o superior** (probado con Node 24). El servidor usa `node:sqlite`, que viene incluido en Node; no hay que compilar nada.
- Para el teléfono: la app **Expo Go** (Android o iOS) en la misma red Wi‑Fi que la computadora, o un emulador.

---

## 1. Ejecutar la app

```bash
cd mobile
npm install
npx expo start
```

- Escanea el código QR con Expo Go (Android) o con la cámara (iOS).
- Pulsa `w` para abrirla en el navegador, `a` para el emulador de Android.

Con esto la app ya funciona completa en el dispositivo. Los datos se guardan localmente con AsyncStorage.

## 2. Levantar el servidor (opcional, para administración)

```bash
cd server
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Edita `.env` y define **`JWT_SECRET`**, un valor aleatorio de al menos 32 caracteres. Puedes generarlo con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Crea el primer administrador. La contraseña se pide por teclado y nunca queda en el código:

```bash
npm run create-admin -- jefa
```

Inicia la API:

```bash
npm start          # http://localhost:4000
```

Notas:
- `npm run create-user -- mesa1` crea un **anotador**: puede sincronizar partidas, pero no entra al panel. Los demás usuarios también se pueden crear desde el panel, en la sección Usuarios.
- Repetir `create-admin` con un usuario existente le restablece la contraseña y cierra sus sesiones (útil si se olvida).
- Node muestra el aviso `ExperimentalWarning: SQLite is an experimental feature`. Es esperado y no afecta el funcionamiento.

## 3. Conectar la app con el servidor

En la app, ve a **Configuración → Servidor y cuenta**:

1. Escribe la dirección del servidor y pulsa **Guardar y probar conexión**.
   - Teléfono físico: usa la IP de la computadora en la red local, por ejemplo `http://192.168.1.50:4000` (`localhost` no funciona desde el teléfono).
   - Emulador de Android: `http://10.0.2.2:4000`.
   - Navegador en la misma computadora: `http://localhost:4000`.
2. Inicia sesión. Si la cuenta es de administrador, aparece **Administración** en el menú.

También puedes preconfigurar la dirección copiando `mobile/.env.example` como `mobile/.env`.

---

## Seguridad

- **Autorización en el servidor:** todas las rutas `/api/admin/*` exigen un token válido, y en **cada petición** el servidor vuelve a cargar el usuario de la base de datos para verificar que siga activo, que su rol sea `admin` y que no se haya invalidado su sesión. Ocultar el menú solo afecta a la interfaz; un anotador que intenta entrar al panel o llamar a la API recibe `403`, y sin token se recibe `401`.
- **Contraseñas** con hash scrypt y sal aleatoria. Cuenta con un mínimo de 10 caracteres, comparación en tiempo constante y bloqueo de 15 minutos tras 5 intentos fallidos.
- **Sesiones:** JWT HS256 firmado con `JWT_SECRET`, con una duración de 12 horas que se puede cambiar. Cambiar la contraseña, el rol o desactivar al usuario invalida sus sesiones al instante.
- **Token en el dispositivo:** se guarda en el almacén cifrado del sistema (Keychain o Keystore, con `expo-secure-store`). En la versión web se usa `sessionStorage`.
- **Sin credenciales en el código:** el secreto vive en `.env` (excluido de git) y los usuarios se crean con el script o desde el panel.
- **Validación en el servidor:** se valida todo lo que envían los dispositivos (enteros no negativos, jugadores, lados, fechas), y el servidor recalcula el ganador por su cuenta en lugar de confiar en el cliente.

### Para producción
- Pon la API detrás de **HTTPS**, por ejemplo con un proxy inverso como Caddy o Nginx. Sin HTTPS, contraseñas y tokens viajan en texto plano.
- Si publicas la versión web, limita `CORS_ORIGINS` a su dominio.
- Respalda periódicamente el archivo SQLite (`DATABASE_PATH`).
- El bloqueo de intentos fallidos vive en memoria y se reinicia si se reinicia el servidor.

---

## Sincronización

- Las partidas se anotan siempre en el dispositivo. Con sesión iniciada, se envían al servidor a los ~1,5 s de cada cambio, cada minuto y al volver a abrir la app. Sin conexión quedan pendientes y se envían después; Configuración muestra cuántas faltan.
- Si un administrador **corrige** una partida, su versión prevalece. El dispositivo la recibe en la siguiente sincronización y puede seguir anotando sobre ella.
- Si un administrador **elimina** una partida, también desaparece de los dispositivos y no vuelve a subirse.
- Las metas y modalidades que define el administrador se aplican en los dispositivos con sesión iniciada.
- Las estadísticas de la app se calculan con las partidas del dispositivo. El ranking del panel abarca todas las partidas sincronizadas.

---

## Pruebas

```bash
cd mobile && npm test          # reglas de partida, validación y recuperación tras reinicio (16 pruebas)
cd mobile && npm run typecheck && npx expo lint
cd server && npm test          # autenticación, permisos, sincronización y correcciones (20 pruebas)
```

Además, se verificó la app web real contra la API con un navegador automatizado: 32 comprobaciones de creación, suma, edición, deshacer, ganador, recuperación tras recargar, revancha, historial, bloqueo de un anotador al entrar al panel, corrección administrativa y su llegada al dispositivo.

---

## Personalizar el diseño

Los colores, la tipografía y los radios están centralizados en [`mobile/src/theme.ts`](mobile/src/theme.ts). La paleta sigue el diseño de referencia: fondo azul marino con luces de estadio, verde lima para el primer lado y morado para el segundo. Con 3 o 4 jugadores se agregan cian y naranja. Los números usan *Barlow Condensed*.

## Estructura del código

| Ruta | Contenido |
| --- | --- |
| `mobile/src/domain/game.ts` | Reglas de la partida (puras y probadas): crear, sumar, editar, deshacer, ganador, revancha, filtros y estadísticas |
| `mobile/src/domain/repository.ts` | Persistencia local, una clave por partida y escrituras en orden |
| `mobile/src/state/AppStore.tsx` | Estado global, guardado inmediato, sesión y sincronización |
| `mobile/src/app/` | Pantallas (Expo Router): `nueva`, `partida`, `historial`, `estadisticas`, `configuracion`, `admin/…` |
| `mobile/src/components/` | Tarjetas de marcador, teclado numérico, menú, diálogos y secciones del panel |
| `server/src/app.js` | Rutas de la API, validación y registro de correcciones |
| `server/src/auth.js` | Hash de contraseñas, tokens y verificación de rol |
| `server/src/db.js` | Esquema SQLite |

## Generar la app instalable

Con [EAS Build](https://docs.expo.dev/build/introduction/), desde `mobile/`:

```bash
npx eas-cli@latest build --platform android
```

Antes, agrega en `mobile/app.json` el identificador del paquete (`android.package` y `ios.bundleIdentifier`, por ejemplo `com.tuempresa.domino`).
