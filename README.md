# Dominó · Marcador de partidas

App móvil para anotar los puntos de partidas presenciales de dominó, con historial, estadísticas y un panel de administración protegido.

```
Dominos/
├── mobile/   App (React Native + Expo SDK 57 + TypeScript, Expo Router). También corre en web/escritorio.
└── server/   API opcional (Node.js + Express + PostgreSQL/Supabase) para la administración compartida y la sincronización.
```

La app funciona completa **sin servidor y sin conexión**. El servidor solo hace falta para el panel de administración, compartir partidas entre dispositivos y el ranking global.

---

## Funciones

**Partidas**
- Modalidad con dos tarjetas grandes: **Individual** (selector desplegable de 2, 3 o 4 jugadores) o **Por parejas** (2 parejas).
- En parejas cada pareja tiene **dos jugadores distintos** y un nombre de equipo editable; si se deja vacío se forma solo, por ejemplo "Marta y Pedro".
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

## Parejas, torneos, estadísticas, rivales y resumen

**Conceptos.** Una **mano** es cada anotación de puntos. Una **partida** termina cuando un lado llega a la meta. Una **ronda** es una fase del cuadro de un torneo (cuartos, semifinal, final…). En la app y en los datos se distinguen siempre.

**Una sola fuente de verdad.** Todo se calcula a partir de las partidas:

- Se registran manos por un único camino (`mutateGame` en `AppStore`).
- El avance del torneo, el campeón, las estadísticas y el historial entre rivales se **derivan** de las partidas terminadas.
- Una corrección se refleja en todo a la vez, y no hay escrituras que puedan quedar a medias entre "resultado" y "avance".
- Registrar una mano o crear la partida de un enfrentamiento es idempotente: un doble toque o un reintento no duplican nada.

**Identidad de jugadores.** Cada persona tiene un ID estable en un registro local (`mobile/src/domain/players.ts`):

- Al escribir un nombre ya registrado se reutiliza su ID.
- Las partidas antiguas se vinculan una sola vez por nombre al abrir la app. No se inventa ningún otro dato.

| Función | Dónde | Cómo funciona |
| --- | --- | --- |
| Partidas por parejas | Nueva partida | Dos jugadores distintos por pareja y nombre de equipo editable. Los puntos suman al equipo y el resultado se atribuye a ambos integrantes. No se puede repetir un jugador. |
| Sorteos | Nueva partida / Nuevo torneo | **Sortear parejas** (exige cantidad par; editable antes de confirmar) y **Sortear quién sale**, con animación breve. Con "Reducir movimiento" (del sistema o en Configuración) se muestra sin animación. El sorteo confirmado se guarda: recargar no vuelve a sortear. |
| Partida de práctica | Nueva partida | Se guarda, pero no cuenta para estadísticas, ranking ni rivales. |
| Torneos | Menú → Torneos | Eliminación directa, individual o por parejas (parejas fijas toda la competencia). Cruces sorteados. Si la cantidad no es potencia de 2, hay **pases automáticos** repartidos e identificados (nunca pase contra pase). Solo avanza el ganador de una partida terminada; los pases no cuentan como victorias. Al terminar la final se muestra el campeón. Un resultado queda **cerrado** cuando la partida siguiente ya empezó, en la app y en el servidor. |
| Estadísticas | Menú → Estadísticas | Por jugador y separadas en individual y parejas: jugadas, ganadas, perdidas, % de victorias, promedio de puntos por partida ("de su equipo" en parejas) y mejor racha. Solo partidas terminadas: excluye canceladas, pendientes, práctica y pases. Sin partidas muestra "—" en lugar de dividir por cero. |
| Historial entre rivales | Menú → Rivales | Dos jugadores (por ID) o dos parejas (por sus integrantes, sin importar orden ni nombre del equipo). Muestra victorias de cada lado, marcadores y fechas, separado por modalidad. |
| Resumen para WhatsApp | Al terminar una partida / Historial | Imagen PNG con nombres, ganador, marcador final, meta, duración y puntos por mano. La duración solo aparece si hay fecha real de inicio y fin. En el teléfono abre el menú nativo para compartir; en la web usa el menú del sistema si el navegador lo permite y, si no, descarga la imagen. |

**Servidor y migración.** `server/sql/schema.sql` agrega, sin borrar datos (`ADD COLUMN IF NOT EXISTS`):

- Las columnas `practice`, `starter_participant_id`, `tournament_id` y `match_id` en `domino.games`.
- La tabla `domino.tournaments`, con RLS.

El servidor la aplica solo al arrancar. Las partidas antiguas quedan como no-práctica y sin torneo. Además:

- La sincronización envía torneos y conserva la identidad de jugadores.
- El ranking del panel excluye las partidas de práctica.
- Las correcciones administrativas de una partida de torneo se rechazan (409) si el enfrentamiento siguiente ya empezó.

## Requisitos

- **Node.js 22 o superior** (probado con Node 24).
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

## 3. Conectar la app con el servidor

En la app, ve a **Configuración → Servidor y cuenta**:

1. Escribe la dirección del servidor y pulsa **Guardar y probar conexión**.
   - Teléfono físico: usa la IP de la computadora en la red local, por ejemplo `http://192.168.1.50:4000` (`localhost` no funciona desde el teléfono).
   - Emulador de Android: `http://10.0.2.2:4000`.
   - Navegador en la misma computadora: `http://localhost:4000`.
2. Inicia sesión. Si la cuenta es de administrador, aparece **Administración** en el menú.

También puedes preconfigurar la dirección copiando `mobile/.env.example` como `mobile/.env`.

---

## Base de datos en Supabase

El servidor usa **PostgreSQL**. Si `DATABASE_URL` está vacío, usa PGlite (PostgreSQL embebido, guardado en `server/data/pglite`), así que puedes desarrollar sin Supabase. Con `DATABASE_URL` se conecta a Supabase o a cualquier otro PostgreSQL. En los dos casos se usa exactamente el mismo esquema.

**Archivos de la base de datos:**

| Archivo | Contenido |
| --- | --- |
| [`server/sql/schema.sql`](server/sql/schema.sql) | Esquema completo: 8 tablas, índices, restricciones y RLS. El servidor lo aplica solo al arrancar (es idempotente). |
| [`server/sql/supabase-permisos.sql`](server/sql/supabase-permisos.sql) | Solo Supabase: quita todo acceso a los roles de la API pública (`anon`, `authenticated`, `service_role`). |

**Tablas** (todas en el esquema privado `domino`):

| Tabla | Para qué |
| --- | --- |
| `users` | Administradores y anotadores, con contraseña en scrypt y versión de sesión. |
| `players` | Jugadores. El nombre es único sin distinguir mayúsculas. |
| `games` | Partidas: estado, modalidad, meta, participantes, lados y revisiones. |
| `game_players` | Quién jugó qué partida y de qué lado. |
| `hands` | Manos de cada partida, en orden. Se borran junto con la partida. |
| `corrections` | Registro de correcciones administrativas: fecha, responsable, motivo, antes y después. |
| `deleted_games` | Partidas eliminadas, para que ningún dispositivo las vuelva a subir. |
| `settings` | Metas predeterminadas y modalidades. |

**Seguridad:** Supabase publica automáticamente una API REST sobre el esquema `public`, que se puede usar con la clave pública del proyecto. Por eso las tablas están en el esquema privado `domino`, que esa API no expone, con RLS activado y sin permisos para los roles públicos. Solo el servidor de la app, conectado con la cadena de PostgreSQL, puede leer y escribir. **No uses las claves `anon` / `service_role` de Supabase en la app**: no hacen falta.

### Pasos para conectar el proyecto con Supabase

1. **Crea el proyecto** en [supabase.com](https://supabase.com) → *New project*. Guarda la **contraseña de la base de datos**, la necesitarás en el paso 4.
2. **Crea las tablas.** En *SQL Editor* → *New query*, pega el contenido de `server/sql/schema.sql` y pulsa **Run**. Luego haz lo mismo con `server/sql/supabase-permisos.sql`. Opcional: en *Table Editor* cambia el esquema a `domino` y verás las 8 tablas.
3. **Descarga el certificado SSL.** Ve a *Project Settings* → *Database* → *SSL Configuration* → **Download certificate** y guárdalo como `server/supabase-ca.crt`. Con él, la conexión va cifrada y el servidor verifica que habla de verdad con Supabase.
4. **Copia la cadena de conexión.** Pulsa el botón **Connect** (arriba en el panel) y elige según dónde vaya a correr el servidor:
   - **Servidor que corre siempre** (tu PC, Render, Railway): *Session pooler*, puerto **5432**.
   - **Vercel u otro serverless:** *Transaction pooler*, puerto **6543**, con `DATABASE_POOL_MAX=1`.

   Reemplaza `[YOUR-PASSWORD]` por tu contraseña. Si tiene caracteres especiales (`@ : / # ?`), escríbelos codificados (`@` → `%40`).
5. **Configura `server/.env`:**
   ```env
   DATABASE_URL=postgresql://postgres.abcdefghij:TU_CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   DATABASE_SSL_CA=./supabase-ca.crt
   DATABASE_POOL_MAX=5
   ```
6. **Crea el primer administrador** directamente en Supabase:
   ```bash
   cd server
   npm run create-admin -- tuusuario
   ```
7. **Arranca el servidor** con `npm start`. Debe mostrar `Base de datos: PostgreSQL (DATABASE_URL)`.

**Notas:**
- `.env` y `supabase-ca.crt` no se suben a git.
- Si el servidor muestra un error de certificado, revisa la ruta de `DATABASE_SSL_CA`. Como último recurso existe `DATABASE_SSL=no-verify`, que cifra pero no verifica el servidor.
- Los datos de prueba que había en el servidor local (SQLite) no se migran: en Supabase empiezas con la base vacía. Las partidas guardadas en los teléfonos se suben solas cuando un usuario inicia sesión.
- El plan gratuito de Supabase pausa el proyecto tras una semana sin uso; se reactiva desde el panel.

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
- Respalda la base de datos (Supabase incluye copias diarias en sus planes de pago; en el gratuito, exporta desde el panel).
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
cd mobile && npm test          # reglas, torneos, estadísticas, sorteos, rivales, resumen, voz y persistencia (65 pruebas)
cd mobile && npm run typecheck && npx expo lint
cd server && npm test          # autenticación, permisos, sincronización, torneos, migración, visión simulada y base de datos (45 pruebas)
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
| `server/src/db.js` | Conexión a PostgreSQL / PGlite |
| `server/sql/schema.sql` | Esquema completo de la base de datos |

## Generar la app instalable

Con [EAS Build](https://docs.expo.dev/build/introduction/), desde `mobile/`:

```bash
npx eas-cli@latest build --platform android
```

Antes, agrega en `mobile/app.json` el identificador del paquete (`android.package` y `ios.bundleIdentifier`, por ejemplo `com.tuempresa.domino`).
