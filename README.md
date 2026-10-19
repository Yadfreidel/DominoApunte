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

**Menú principal (☰):** Nueva partida, Partida en curso, Historial, Torneos, Estadísticas, Rivales y Configuración. El panel de administración **no aparece en el menú**: se entra escribiendo `/admin` en la dirección (ver [Panel de administración privado](#panel-de-administración-privado)).

**Historial**
- Guarda la fecha, los participantes, la modalidad, la meta, el resultado y el detalle de cada mano.
- Filtros por fecha (hoy, 7 días, 30 días o un rango), por jugador y por estado: pendiente, terminada o cancelada.
- El detalle es de **solo lectura**: no hay controles para modificar resultados.

**Panel de administración privado:** ver la sección [Panel de administración privado](#panel-de-administración-privado).

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

## Panel de administración privado

Se entra en **`/admin`**; no hay enlaces en el menú público. Acceso con **correo y contraseña** de una cuenta de propietario o administrador, con **¿Olvidaste tu contraseña?** y **Salir**. No existe registro público: las cuentas se crean desde el servidor o desde el panel.

**Roles**
- **Propietario:** control total. Es el único que crea o modifica administradores. **Solo se asigna desde el servidor**, nunca desde la app.
- **Administrador:** usa todos los módulos y gestiona anotadores.
- **Anotador:** registra y sincroniza sus partidas; no entra al panel.
- Los **perfiles de jugador** son distintos de las cuentas: un jugador no necesita cuenta. Una cuenta se puede vincular a un perfil desde **Cuentas**.

**Cómo asignarte el rol de propietario de forma segura**
1. En la computadora donde está el servidor (con `server/.env` apuntando a Supabase), ejecuta:
   ```bash
   cd server
   npm run set-owner -- tunombre --email tu@correo.com
   ```
2. Escribe la contraseña dos veces cuando la pida; no se muestra ni queda en el historial. Mínimo 10 caracteres.
3. Entra en `https://tu-app/admin` con ese correo.

Repetir el comando restablece la contraseña y cierra todas las sesiones de la cuenta.

**Módulos**

| Módulo | Qué hace |
| --- | --- |
| Resumen | Jugadores, partidas, en curso, torneos activos, de prueba, papelera, últimas actividades y partidas recientes (datos reales del servidor). |
| Partidas | Filtros por jugador, fecha, estado y tipo, con paginación. El detalle permite corregir y eliminar manos, cancelar o reabrir, marcar como prueba y enviar a la papelera. |
| Jugadores | Búsqueda y paginación. Editar nombre y foto, desactivar el perfil, bloquear la cuenta vinculada y enviar a la papelera (el historial se conserva). |
| Duplicados | Detecta nombres iguales sin contar tildes ni mayúsculas; también permite fusión manual. Se elige el perfil principal, se ve una vista previa (partidas, torneos y conflictos) y se fusiona en una sola transacción. Se bloquea si dejaría a una persona dos veces en una partida o en un torneo. Los nombres anteriores quedan como alias para que no se vuelvan a crear. |
| Torneos | Crear (con organizador), pausar, reanudar y cancelar. Cambiar el nombre de una pareja, reemplazar jugadores de quien todavía no jugó y volver a sortear mientras no haya partidas. Los resultados se corrigen desde la partida; quedan cerrados si el enfrentamiento siguiente ya empezó. |
| Reglas | Meta y modalidad predeterminadas y penalización opcional de **puntos por pase**. Son sugerencias para partidas nuevas: el usuario las cambia en cada partida, y cada partida guarda sus propias reglas, así que nada existente cambia. |
| Pruebas | Lista de partidas de prueba o práctica (no cuentan en estadísticas) y **Limpiar pruebas**, que las envía a la papelera sin tocar las oficiales. |
| Papelera | Restaurar partidas y perfiles, o eliminarlos definitivamente escribiendo `ELIMINAR`, viendo antes sus dependencias. Si restaurar genera un conflicto (por ejemplo, otra partida ya ocupa ese enfrentamiento o un jugador está en la papelera), se explica y no se restaura nada. Un perfil con historial no se borra definitivamente: se deja en la papelera o se fusiona. |
| Auditoría | Autor, fecha, acción, motivo y valores anteriores y nuevos de cada cambio administrativo, con filtros y paginación. Nunca guarda contraseñas, hashes, tokens ni imágenes completas. |
| Exportar | CSV de partidas, resultados, jugadores y estadísticas según los filtros. Sin correos, contraseñas, fotos ni datos de cuentas, y con las celdas protegidas contra fórmulas de Excel. |
| Ranking | Solo partidas oficiales (sin pruebas ni papelera). |
| Identidad visual | Nombre de la app, subtítulo, texto de bienvenida y logo (PNG, JPEG o WebP; máximo 300 KB, entre 32 y 1024 px, validado también en el servidor). Tiene vista previa, Guardar, Cancelar y **Restaurar originales**. |
| Apariencia | Temas Original, Verde dominó, Azul, Morado, Rojo y Oscuro, o seis colores propios: principal, secundario, fondo, tarjetas, texto y botones. Vista previa, comprobación de contraste (WCAG 4.5:1 para texto y 3:1 para acentos), Guardar, Cancelar y **Restaurar tema original**. |
| Cuentas | Crear cuentas (sin registro público), editar el correo, cambiar la contraseña, vincular un perfil de jugador, bloquear o desbloquear, y cambiar el rol (solo el propietario). |

Todas las acciones destructivas piden confirmación y motivo, y los botones se bloquean mientras se guarda para evitar envíos duplicados.

**Tema global.** Los colores están centralizados en [`mobile/src/domain/appearance.ts`](mobile/src/domain/appearance.ts) y [`mobile/src/theme.ts`](mobile/src/theme.ts). Así se aplica el tema:
- El tema elegido se guarda en el servidor y en cada dispositivo.
- Al abrir la app se aplica antes de dibujar la primera pantalla: lo leen [`mobile/index.js`](mobile/index.js) → `src/boot/theme`, y en la web también un script de `public/index.html` que pinta el fondo. Por eso no hay destellos.
- En la web, el administrador ve el tema al instante (la app se recarga). Los demás dispositivos lo ven la próxima vez que abran la app.

En la web, además:
- El foco del teclado se marca con un contorno grueso del color principal.
- Los botones cambian suavemente al pasar el cursor.
- Las transiciones se desactivan si el sistema pide reducir el movimiento.

**Recuperación de contraseña por correo.** Necesita una cuenta de [Resend](https://resend.com) y tres variables en `server/.env`:

| Variable | Valor |
| --- | --- |
| `RESEND_API_KEY` | La clave de la API. |
| `MAIL_FROM` | Un remitente de un dominio verificado en Resend. |
| `APP_URL` | La dirección pública de la app. |

Cómo funciona el enlace:
- Vence en 30 minutos y sirve una sola vez.
- El servidor guarda solo su hash.
- La respuesta es la misma exista o no la cuenta.
- Al usarlo se cierran todas las sesiones de la cuenta.

Sin esas variables, el panel avisa que la recuperación por correo no está configurada. Entonces la contraseña se restablece con `npm run set-owner`.

**Migración (`server/sql/schema.sql`, bloque «2026-11»).** No borra datos y se aplica sola al arrancar el servidor. Agrega:
- Correo, rol `propietario` y vínculo con un perfil de jugador en las cuentas.
- La tabla `password_resets`.
- Foto y papelera en los jugadores, y la tabla `player_aliases`.
- Papelera y `rules_json` en las partidas.
- Estado `pausado` y `admin_revision` en los torneos.
- El disparador que hace inmutable la auditoría.

Todas las tablas nuevas tienen RLS. En Supabase, después de arrancar el servidor una vez, vuelve a ejecutar [`server/sql/supabase-permisos.sql`](server/sql/supabase-permisos.sql) en el SQL Editor para retirar a las claves públicas el acceso a las tablas nuevas.

## Publicación en internet (Vercel)

- **App:** https://dominoapunte-mobile.vercel.app. Se publica sola con cada `git push` a `main`.
  - Usa el servidor indicado en [`mobile/.env.production`](mobile/.env.production).
  - Si un teléfono tenía guardada una dirección `http://` de la red local, la app la reemplaza sola por la del servidor publicado.
- **Servidor:** https://dominoapunte-server.vercel.app, en el proyecto de Vercel `dominoapunte-server`.
  - Entrada: [`server/api/index.js`](server/api/index.js).
  - Se conecta a Supabase por el **Transaction pooler** (puerto 6543), con el certificado verificado.
  - El esquema solo se aplica cuando cambia: guarda su versión en `domino.settings` y usa un bloqueo para que dos arranques no choquen.
- **Variables:** viven solo en Vercel (Settings → Environment Variables), nunca en git:
  - `DATABASE_URL`, `DATABASE_SSL_CA` (el certificado como texto), `DATABASE_POOL_MAX=1`
  - `JWT_SECRET`, `JWT_EXPIRES_IN`
  - `CORS_ORIGINS` (solo el dominio de la app)
  - `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`
- **Volver a publicar el servidor** después de cambiar su código:
  ```bash
  cd server
  npx vercel deploy --prod
  ```
  `.vercelignore` impide que se suban `.env`, el certificado o datos locales.

## Rachas, grupos, temporadas, pantalla grande y tarjeta del ganador

| Función | Dónde aparece | Cómo funciona |
| --- | --- | --- |
| Rachas | Estadísticas (columnas «Act.» y «Mejor», ficha de cada jugador, pestaña «Parejas fijas»), celebración y tarjeta del ganador | Racha actual y mejor racha por jugador y por pareja. La pareja se reconoce por sus dos integrantes, sin importar el orden ni el nombre del equipo. |
| Rivalidades | Rivales (mensajes y últimos resultados) y una nota breve en «Así se enfrentan» antes de jugar | Victorias de cada lado, total, racha dentro de la rivalidad y mensajes como «La serie está 5 a 4…; … pueden empatar». No mezcla modalidades, y cada resultado muestra su meta. |
| Grupos | Menú → Grupos | Grupo privado con nombre, descripción e imagen opcional. Se invita con un código o un enlace que vence en 7 días y se puede revocar. Roles: propietario, administrador y miembro. Clasificación, rachas e historial del grupo. Una partida se asocia a un grupo de forma opcional en Nueva partida → «Grupo y temporada». |
| Temporadas | Grupo → Temporadas | Nombre, fechas, zona horaria del grupo, modalidades admitidas y clasificación individual o por parejas. Las reglas se ven antes de empezar y no cambian después. Incluye clasificación con progreso, archivo de temporadas y campeón o campeones. |
| Pantalla grande | Marcador → «Pantalla grande» | Enlace de espectador con QR para abrir en el navegador de una TV, un monitor o una tableta. Es de solo lectura y revocable. Se actualiza cada 2,5 s, indica «Sin conexión» o «Datos desactualizados» y se recupera al reconectar. Ofrece pantalla completa en la web. |
| Tarjeta del ganador | Celebración, tarjeta final de la partida e Historial → «Compartir victoria» | Imagen PNG con vista previa: nombre de la app (y logo), ganador, fotos o iniciales, marcador final, meta, fecha, duración real y una frase. La racha aparece solo si está calculada. Se comparte con el menú del sistema o se descarga. |

**Reglas de cálculo**
- Cuentan solo las partidas terminadas, con ganador, que no son de práctica ni están en la papelera.
- En el dominó no hay empates: cada partida válida es una victoria o una derrota, y una derrota corta la racha. Las canceladas o abandonadas no cuentan ni cortan la racha.
- El orden es cronológico y estable (fecha de fin, fecha de inicio, identificador), sin depender del orden de sincronización.
- Las correcciones y anulaciones recalculan todo, porque todo se deriva de las partidas guardadas.
- En los grupos, cada persona es su perfil del servidor (identificador estable). Las fusiones de duplicados las hace el administrador en el panel; la app nunca une a dos personas por tener el mismo nombre.

**Temporadas**
- Clasificación: X puntos por victoria e Y por derrota, configurables (por defecto 3 y 0). Son puntos de clasificación, distintos de los puntos de las manos.
- Desempates, en este orden: victorias entre los empatados, % de victorias y diferencia de puntos anotados. Si persiste el empate, comparten la posición y, si es la primera, el título (campeones compartidos).
- Cada partida se asocia de forma explícita al crearla, y solo a una temporada; las anteriores no se incorporan.
- El servidor valida al sincronizar que la cuenta sea integrante, que la temporada esté en curso al empezar la partida y que admita su modalidad. Si no, la guarda sin temporada y avisa.
- **Cierre:** al pasar la fecha final no se aceptan partidas nuevas. Las que estaban en curso cuentan si terminan a más tardar el día siguiente. Después la temporada se finaliza:
  - Lo hace un proceso diario de Vercel (Cron, a las 9:00 UTC) y también la primera consulta posterior.
  - El cierre es idempotente y guarda el resultado con su historial de revisiones. Si una corrección autorizada posterior cambia el resultado, se registra como una revisión nueva.

**Permisos (verificados en el servidor)**
- Solo los integrantes ven un grupo; a los demás se les responde como si no existiera.
- Solo el propietario cambia roles, y el grupo nunca queda sin propietario. Un administrador del grupo invita, crea temporadas y quita miembros.
- Ser administrador de un grupo no da permisos globales en la app, y ser administrador de la app no da acceso a grupos privados.
- El enlace de espectador usa un token aleatorio de 192 bits, del que solo se guarda el hash. Muestra nombres y puntos de esa partida, sin cuentas, grupos ni identificadores.

**Migración «2026-12» (`server/sql/schema.sql`)**
- Agrega las tablas `groups`, `group_members`, `group_invites`, `seasons` y `spectator_links`, con índices y RLS.
- Agrega las columnas `group_id` y `season_id` en `games`.
- No modifica datos existentes y se aplica sola al arrancar el servidor. En Vercel, la primera petición después de publicar.

**Configuración**
- En Vercel (proyecto `dominoapunte-server`), la variable `CRON_SECRET`: Vercel la usa para autorizar el cierre diario de temporadas.
- Los grupos necesitan cuentas de la app, que crea el administrador (no hay registro público).

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

Asigna la cuenta del **propietario** (tu cuenta). La contraseña se pide por teclado y nunca queda en el código ni en el historial de la terminal:

```bash
npm run set-owner -- tunombre --email tu@correo.com
```

Inicia la API:

```bash
npm start          # http://localhost:4000
```

Notas:
- `npm run create-user -- mesa1` crea un **anotador**: registra y sincroniza sus partidas, pero no entra al panel. Las cuentas también se crean desde el panel, en **Cuentas**.
- Repetir `set-owner` (o `create-admin`) con un usuario existente le restablece la contraseña y cierra sus sesiones. Es la recuperación de emergencia si no está configurado el correo.

## 3. Conectar la app con el servidor

En la app, ve a **Configuración → Servidor y cuenta**:

1. Escribe la dirección del servidor y pulsa **Guardar y probar conexión**.
   - Teléfono físico: usa la IP de la computadora en la red local, por ejemplo `http://192.168.1.50:4000` (`localhost` no funciona desde el teléfono).
   - Emulador de Android: `http://10.0.2.2:4000`.
   - Navegador en la misma computadora: `http://localhost:4000`.
2. Inicia sesión con tu correo (o usuario) para sincronizar tus partidas. El panel está en `/admin` (por ejemplo `https://tu-app.vercel.app/admin`).

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
6. **Asigna tu cuenta de propietario** directamente en Supabase:
   ```bash
   cd server
   npm run set-owner -- tunombre --email tu@correo.com
   ```
7. **Arranca el servidor** con `npm start`. Debe mostrar `Base de datos: PostgreSQL (DATABASE_URL)`.

**Notas:**
- `.env` y `supabase-ca.crt` no se suben a git.
- Si el servidor muestra un error de certificado, revisa la ruta de `DATABASE_SSL_CA`. Como último recurso existe `DATABASE_SSL=no-verify`, que cifra pero no verifica el servidor.
- Los datos de prueba que había en el servidor local (SQLite) no se migran: en Supabase empiezas con la base vacía. Las partidas guardadas en los teléfonos se suben solas cuando un usuario inicia sesión.
- El plan gratuito de Supabase pausa el proyecto tras una semana sin uso; se reactiva desde el panel.

## Seguridad

- **Autorización en el servidor:** todas las rutas `/api/admin/*` exigen un token válido, y en **cada petición** el servidor vuelve a cargar el usuario de la base de datos para verificar que siga activo, que su rol sea `propietario` o `admin` y que no se haya invalidado su sesión. La pantalla `/admin` solo decide qué mostrar; un anotador que entra al panel o llama a la API recibe `403`, y sin token se recibe `401`.
- **Dueño de cada partida:** al sincronizar, una cuenta solo puede modificar las partidas y torneos que registró ella. Los administradores pueden modificar cualquiera.
- **Base de datos:** el esquema `domino` no está publicado por la API de Supabase y tiene RLS activado sin políticas. El registro de auditoría tiene un disparador que impide editarlo o borrarlo, incluso desde el propio servidor.
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
- Si un administrador envía una partida a la **papelera**, desaparece de los dispositivos y deja de contar. Si la restaura, el dispositivo de su dueño la recupera. Si la elimina definitivamente, no vuelve a subirse.
- Los torneos que el administrador crea, pausa, cancela o corrige llegan al dispositivo de su organizador al sincronizar.
- Los valores predeterminados, la identidad visual y el tema se leen de `/api/public/config` al abrir la app, aun sin sesión, y quedan guardados para usarse sin conexión.
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
  5. Ver el "Total: N puntos" y, si se quiere, pulsar **"Escuchar total"** (lee "El total es trece puntos" con la voz del sistema, `expo-speech`).
  6. Confirmar el grupo, elegir a quién se le suman y pulsar **"Confirmar y sumar"**. Nunca se suma sin esta confirmación, y el doble toque no suma dos veces.
  - "Repetir la foto" descarta el grupo actual y vuelve a abrir la cámara.
  7. Si hace falta, contar varios grupos en una misma mano. Cada grupo se confirma una vez y no se suma dos veces.
  8. "Contar a mano" permite hacer todo sin foto y sin internet.
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
- **Configuración necesaria** (sin la clave, el botón de foto queda bloqueado y la app ofrece "Contar a mano"):
  1. Crear una clave en [platform.claude.com](https://platform.claude.com) → API Keys. Nunca va en la app.
  2. Servidor publicado: en Vercel, proyecto `dominoapunte-server` → Settings → Environment Variables, agregar `ANTHROPIC_API_KEY` (Production) y volver a publicar. Servidor local: ponerla en `server/.env` y reiniciarlo.
  3. Iniciar sesión en la app (Configuración). El análisis exige sesión porque tiene costo.
- **Límites de Vercel:** la función del servidor tiene hasta 300 s (máximo del plan Hobby) y la app comprime la foto para que la petición no supere el límite de 4,5 MB.
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
cd mobile && npm test          # reglas, torneos, estadísticas, sorteos, rivales, resumen, temas, reglas por partida, voz y persistencia (76 pruebas)
cd mobile && npm run typecheck && npx expo lint
cd server && npm test          # autenticación, roles, recuperación, papelera, fusiones, torneos, auditoría, exportación, temas, migración y visión simulada (64 pruebas)
```

Además, se verificó la app web real contra la API con un navegador automatizado: 32 comprobaciones de creación, suma, edición, deshacer, ganador, recuperación tras recargar, revancha, historial, bloqueo de un anotador al entrar al panel, corrección administrativa y su llegada al dispositivo.

---

## Personalizar el diseño

Los colores, la tipografía y los radios están centralizados en [`mobile/src/theme.ts`](mobile/src/theme.ts), y los temas en [`mobile/src/domain/appearance.ts`](mobile/src/domain/appearance.ts). El administrador puede cambiar el tema global desde el panel (Apariencia). La paleta sigue el diseño de referencia: fondo azul marino con luces de estadio, verde lima para el primer lado y morado para el segundo. Con 3 o 4 jugadores se agregan cian y naranja. Los números usan *Barlow Condensed*.

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
