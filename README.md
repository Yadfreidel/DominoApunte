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

## Anotación por voz y conteo de fichas con cámara

Las dos funciones **solo proponen** una anotación. El marcador cambia únicamente cuando el usuario pulsa **Confirmar**, y la mano se registra con el mismo mecanismo que la anotación manual (`addHand` con un identificador de mano fijo, así que un doble toque o un reintento no la duplican). Cancelar nunca modifica el marcador, y la anotación manual (tocar la tarjeta del equipo) está disponible en todo momento.

### Voz ("Voz" en el marcador)

- **Tecnología:** [`expo-speech-recognition`](https://github.com/jamsch/expo-speech-recognition) `57.1.1` (versión para Expo SDK 57). Usa el reconocimiento de voz del sistema: Apple en iPhone, el servicio de reconocimiento de Android (normalmente Google) y la Web Speech API en el navegador.
- **Dónde funciona:**
  - **No funciona en Expo Go**, porque es un módulo nativo. La app lo detecta, avisa y ofrece "Anotar a mano". En el teléfono hace falta la versión instalable (*development build* o APK/IPA con EAS, ver abajo).
  - En la web funciona con **Chrome** (escritorio y Android) y **Safari 16+**; no funciona en Firefox ni en Brave.
- **Conexión:** según el dispositivo, el reconocimiento puede **requerir internet** y enviar el audio a Apple o Google para transcribirlo. La app no graba ni guarda audio.
- **Flujo:** escuchando → procesando → revisión (texto escuchado editable, destinatario y puntos) → "Sumar 23 puntos a Juan" → Confirmar / Cancelar. Si falla (permiso denegado, sin voz, sin red, no disponible), muestra el motivo y ofrece la entrada manual.
- **Interpretación** (`mobile/src/domain/voice.ts`, código propio y probado):
  - Entiende números en cifras o en palabras ("veintitrés", "ciento treinta y cinco").
  - Los nombres se resuelven **solo** contra la partida activa: nombre del jugador, primer nombre, nombre del equipo, "pareja 2" y colores ("equipo verde/morado").
  - Si el nombre es ambiguo, se mencionan varios destinatarios, falta el número, hay varios números o se supera el máximo de 1000 por mano, **no adivina**: pide elegir o corregir.
  - Ante nombres parecidos ("Martha" por "Marta") sugiere, pero no elige.
- **Una sola escucha a la vez:** al cerrar la ventana se cancela la escucha y se libera el micrófono.
- **Costo:** ninguno para la app; usa el servicio del sistema.

### Conteo de fichas ("Contar fichas" en el marcador)

- **Flujo:**
  1. Elegir el conjunto: doble seis, doble nueve o doble doce.
  2. Leer la guía de foto: fichas completas y separadas, boca arriba, fondo liso, buena luz y cámara desde arriba.
  3. Tomar una foto o elegir una imagen.
  4. Revisar el resultado: marcas numeradas sobre la foto y la lista "Ficha 1: 6 | 4 = 10", con botones − / + por mitad, eliminar ficha, "Está bien" y agregar una ficha omitida.
  5. Confirmar el grupo, elegir a quién se le suman y pulsar "Sumar N puntos a X".
  6. Si hace falta, contar varios grupos en una misma mano. Cada grupo se confirma una vez y no se suma dos veces.
  7. "Contar a mano" permite hacer todo sin foto y sin internet.
- **Reglas que aplica el código, no el modelo:**
  - El total se calcula sumando mitades y la mitad en blanco vale 0.
  - Un valor fuera del conjunto o ilegible queda vacío y marcado para revisión.
  - Dos rectángulos casi idénticos se marcan como "posible duplicado". Dos fichas físicas iguales en lugares distintos **no** se marcan.
  - No se puede confirmar un grupo con fichas pendientes de revisión.
  - No se muestran porcentajes de confianza, porque el servicio no entrega una confianza calibrada.
- **Servicio:** el servidor envía la foto a la API de Claude (modelo `claude-opus-5-5`) con salida estructurada por ficha: ubicación, mitad 1, mitad 2 y si requiere revisión. La documentación oficial advierte que el conteo de objetos y las coordenadas son aproximados; por eso todo pasa por la revisión del usuario. Para que las marcas coincidan con la foto:
  - La app reduce la imagen al tamaño máximo que el modelo procesa sin reescalar: 2576 px de lado y 4784 tokens visuales.
  - El servidor rechaza cualquier imagen que el modelo fuera a reescalar.
  - Si el modelo declina la solicitud, el servidor la reintenta con el modelo alternativo predeterminado de la API (`fallbacks: "default"`).
- **Privacidad:** la foto viaja de la app al servidor y del servidor a Anthropic solo para el análisis; **no se guarda** ni en el teléfono, ni en el servidor, ni en registros. Según Anthropic, las imágenes enviadas a la API no se usan para entrenar modelos.
- **Configuración necesaria:**
  1. Crear una clave en [platform.claude.com](https://platform.claude.com) y ponerla en `server/.env` como `ANTHROPIC_API_KEY=...`. Nunca va en la app.
  2. Reiniciar el servidor.
  3. Iniciar sesión en la app (Configuración). El análisis exige sesión porque tiene costo.
- **Costo estimado:** con las tarifas publicadas de Claude Opus 5.5 ($4 por millón de tokens de entrada y $20 por millón de salida), una foto de tamaño máximo son ≈4.800 tokens de imagen (≈$0,02). El modelo además genera texto de razonamiento y respuesta, que se cobra como salida; el costo total por foto aún **no se midió**, porque no había una clave disponible durante el desarrollo.
- **Límites:** 30 análisis cada 10 minutos por usuario, 2 minutos de espera máxima y cancelación al salir de la pantalla. Una respuesta tardía nunca se aplica a otra partida ni a otro grupo.

### Generar la versión instalable (necesaria para la voz en el teléfono)

```bash
cd mobile
npx eas-cli@latest build --profile development --platform android   # o --platform ios
```

Se necesita una cuenta gratuita de Expo. Antes, agrega `android.package` / `ios.bundleIdentifier` en `app.json`.

### Qué está verificado y qué falta

| | Estado |
|---|---|
| Lógica de voz (números, nombres, ambigüedades, límites) | 11 pruebas con **transcripciones escritas** (varias frases cada una) |
| Lógica de conteo y tamaño de foto (mitades en blanco, revisión, duplicados, grupos, total) | 8 pruebas con **datos simulados** |
| Servidor de visión (validación de imagen, normalización, errores, sin clave) | 12 pruebas con **servicio simulado** |
| Flujo completo en el navegador (cancelar no cambia nada, cada confirmación registra una sola mano, respuesta tardía descartada, permiso denegado) | 19 comprobaciones con **voz y visión simuladas** |
| **Reconocimiento real de voz** | **No probado**: no hubo micrófono, audios ni dispositivo físico disponibles. |
| **Reconocimiento real de fichas** | **No probado**: no había clave de la API ni fotos reales. **0 muestras reales evaluadas.** |

**Pruebas reales pendientes antes de usarlo en producción:**

- **Voz, en Android y iPhone con la versión instalable:**
  - Números dichos en cifras y en palabras (5, 15, 23, 35, 100, 135).
  - Nombres parecidos (Juan y Juana, Marta y Martha).
  - Ruido de mesa.
  - Frases incompletas.
  - Cancelar a mitad.
  - Permiso de micrófono denegado y luego concedido.
  - Modo avión.
- **Cámara, con al menos 30 fotos reales por conjunto:**
  - Fichas en blanco (0|0) y dobles.
  - Fichas giradas y verticales.
  - De 1 a 20 fichas.
  - Sombras, reflejos y fichas encimadas o cortadas.
  - Fotos sin dominó y fichas boca abajo.
  - Registrar, por cada foto, cuántas fichas se detectaron bien, cuántas mitades estuvieron bien y el costo real (tokens de `usage`).
- Verificar en el teléfono que una mano confirmada aparece una sola vez después de sincronizar.

## Pruebas

```bash
cd mobile && npm test          # reglas de partida, voz, conteo de fichas y recuperación (38 pruebas)
cd mobile && npm run typecheck && npx expo lint
cd server && npm test          # autenticación, permisos, sincronización, correcciones y visión simulada (33 pruebas)
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
