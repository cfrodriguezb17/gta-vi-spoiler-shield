# Protección de spoilers de GTA VI

Extensión Manifest V3 para Reddit, YouTube, X, Facebook e Instagram. El modo **Preventivo** funciona desde la instalación, incluso con el servidor apagado. Cubre la tarjeta completa, pausa su reproducción y permite revelarla con **Mostrar**. En el panel puedes desactivar cada red, pasar al modo **Inteligente** e indicar el número de la última misión completada.

## Instalar

- **Chrome.** Descomprime `dist/chrome.zip`. En `chrome://extensions`, activa el modo de desarrollador y usa **Cargar descomprimida** para seleccionar la carpeta que contiene `manifest.json`.
- **Firefox.** En `about:debugging#/runtime/this-firefox`, usa **Cargar complemento temporal** y selecciona `dist/firefox.zip` o `dist/firefox/manifest.json`. La instalación temporal dura hasta cerrar Firefox. El ZIP se puede enviar al proceso de firma para distribución permanente.

Recarga las pestañas que ya estaban abiertas al instalar. Los paquetes incluidos consultan el catálogo en `http://127.0.0.1:5071`. Para que varias personas compartan un catálogo, expón la API mediante HTTPS en un dominio propio y compila ambos paquetes con ese origen. Ejemplo en PowerShell, desde la raíz del proyecto, con Bun y la herramienta ZIP del sistema:

```powershell
$env:CATALOG_URL = 'https://catalogo.ejemplo.org'
bun run build
```

La compilación incorpora el origen al código de sincronización y al permiso de host. Todos los scripts y el módulo WebAssembly se distribuyen en el ZIP. La extensión solicita el catálogo al instalar, al iniciar el navegador, cada hora o al pulsar **Sincronizar**.

## Activar la campaña

1. Copia `.env.example` a `.env`. Configura una contraseña para PostgreSQL, la clave de Gemini y el presupuesto máximo de peticiones. El modelo predeterminado para la extracción es `gemini-3.5-flash-lite`. Si ya tienes un `.env` con `gemini-2.5-flash`, actualiza `GEMINI_MODEL`. YouTube Data API usa `YOUTUBE_KEY`. Reddit usa una aplicación autorizada con credenciales de cliente y un `SOURCE_USER_AGENT` identificable para el operador. [Modelos en retirada de Gemini](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models)
2. Revisa `Sources` en `backend/appsettings.json` antes de activar la campaña. Conserva las fuentes cuyo contenido puedes procesar con Gemini. La configuración incluye Reddit, YouTube y feeds de prensa, wiki y guías. Para añadir un RSS/Atom propio, configura `Id`, `Kind=feed`, `Url` y `Trust`. Los valores de confianza admitidos son `community`, `editorial`, `guide` y `official`. Usa `Origin` cuando varios feeds pertenezcan al mismo origen. `FilterGame` limita la extracción de un feed general a entradas que mencionan GTA VI.
3. Levanta los servicios y ejecuta la activación cuando deban empezar los cinco días.

```sh
docker compose up --build -d
docker compose exec api dotnet Shield.dll start-campaign
docker compose exec api dotnet Shield.dll status
```

Compose mantiene PostgreSQL con pgvector en un volumen y ejecuta el codificador en la red interna. La API escucha en el puerto local 5071. El comando de activación es idempotente. Todas las instalaciones comparten el mismo inicio UTC aunque se conecten en días distintos.

El trabajador comprueba cada cinco segundos si hay una revisión pendiente. La hora inicial es el intervalo 0 y la última revisión es la 119. Un bloqueo de PostgreSQL coordina las réplicas. Tras una interrupción, el trabajador recupera la revisión en curso o marca las horas pasadas como omitidas y hace una lectura desde el cursor de cada fuente. El vencimiento cancela la recolección en curso. La API y el catálogo continúan disponibles.

## Catálogo, evidencias y consumo

El backend usa las API de Reddit y YouTube y el contenido que publica cada feed para descubrir documentos. Una huella del texto, fecha, enlace y origen evita repetir extracciones. Gemini recibe el documento y devuelve afirmaciones con un pasaje de respaldo. El trabajador verifica que el pasaje exista literalmente. Los cambios de evidencia y publicación se confirman en la misma transacción. Las tablas `documents`, `revisions` y `evidence` permiten seguir una afirmación hasta su referencia. [Salidas estructuradas de Gemini](https://ai.google.dev/gemini-api/docs/structured-output)

La búsqueda HNSW de pgvector propone coincidencias. El backend comprueba los papeles, la acción, la negación y la misión antes de fusionar. Una fuente editorial o guía directa puede hacer probable un evento. Una referencia oficial directa o dos orígenes independientes con evidencia directa fiable permiten confirmarlo. Las citas de un mismo origen y los pasajes copiados se agrupan. Los rumores sin atribución carecen de peso para el recuento de orígenes independientes. Las correcciones sustituyen la evidencia del documento y pueden retirar el evento.

`GET /api/world` presenta los personajes, las locaciones y los sucesos divulgados en el material promocional oficial, con sus referencias. La extensión reconoce nombres completos y locaciones distintivas como señales de contexto. En modo Inteligente también debe coincidir un evento publicado. Conserva los títulos de GTA V y los lugares compartidos como Vice City fuera de esas señales por sí solos.

Para cargar los sucesos verificados en un catálogo nuevo o volver a aplicar la referencia tras editar `shared/official-world.json`, recompila el servicio y ejecuta:

```sh
docker compose exec api dotnet Shield.dll import-official-world
```

La importación usa el codificador y el catálogo existentes. Cada suceso conserva su fuente y un extracto de respaldo. Las misiones quedan sin número hasta que lo respalde una fuente.

`status` muestra inicio y fin UTC, revisiones completadas y omitidas, fallos por fuente, peticiones reservadas a Gemini, tokens declarados por sus respuestas y última versión publicada. Una revisión completada puede contener fuentes fallidas. El detalle de cada fallo queda en `runs.detail`. El límite de peticiones es compartido y persiste tras reinicios. Una llamada fallida consume su reserva. Los tokens de una respuesta perdida quedan fuera del contador.

| Petición | Resultado |
| --- | --- |
| `GET /api/spoilers` | Copia completa de eventos probables y confirmados, en `added`. |
| `GET /api/spoilers?since=1834` | Cambios netos desde esa versión en `added`, `updated` y `deleted`. |
| Cursor futuro o más de 10 000 versiones por detrás | HTTP 410. El cliente vuelve a pedir la copia completa. |

Ambas respuestas incluyen `version` y `modelVersion`. IndexedDB guarda la versión y las mutaciones juntas. El cliente valida la respuesta antes de aplicar el lote. Ante un cambio de modelo pide una copia completa y acepta la versión compatible con su codificador. Para desplegar otro modelo, prepara sus vectores en una base nueva y distribuye el cliente compatible.

## Detección local

Esta entrega usa `vi-lex-es-en-384-v1`, un codificador léxico de 384 dimensiones con vocabulario narrativo bilingüe y normalización L2 en WebAssembly. El navegador y el servicio de embeddings ejecutan los mismos archivos de `shared/`. En Chrome la inferencia se ejecuta en el service worker y en Firefox en un Web Worker. La coincidencia contrasta participantes, dirección de la acción y negaciones con los eventos publicados. Los eventos de misión desconocida siguen protegidos aunque se indique progreso.

El modelo E5 planteado inicialmente requería pesos que este entorno no pudo descargar. El codificador incluido reconoce las formas del vocabulario, los alias y las expresiones extraídas de las fuentes. Las paráfrasis nuevas, la ironía y las atribuciones ambiguas pueden escapar al filtro. El modo preventivo ofrece cobertura cuando el catálogo es pequeño. Imágenes y vídeos se clasifican por el texto y los atributos accesibles de su tarjeta. El texto leído, las preferencias y el progreso permanecen en el dispositivo.

## Verificación

```sh
bun run build
bun run test
dotnet build backend/Shield.csproj
```

La prueba de integración en `tests/server` usa un esquema temporal de PostgreSQL, el codificador real y un reloj controlado. Inicia `bun run encoder`, define `TEST_DATABASE` con una conexión a una base de ensayo y ejecuta `dotnet run --project tests/server`. Con pgvector instalado, define `TEST_PGVECTOR=1` para recorrer la implementación HNSW. La variante local usa búsqueda exacta en `real[]`. Si el codificador se ejecuta en otro host, indica su URL completa en `TEST_ENCODER_URL`. Recompila el núcleo si editas Rust:

```sh
rustc --edition=2021 --crate-type=cdylib --target wasm32-unknown-unknown -C opt-level=s -C panic=abort -C strip=symbols shared/vector.rs -o shared/vector.wasm
```

`bun tests/browser.ts` instala los dos paquetes en perfiles temporales y sirve páginas HTTPS locales con las estructuras de las cinco redes. Necesita el puerto 5071 libre, OpenSSL, Playwright, Chrome o Chromium y Firefox. Define `PLAYWRIGHT_MODULE` si Playwright está fuera del proyecto, `CHROMIUM` y `FIREFOX` para elegir los ejecutables, y `OPENSSL` si no está en el PATH. Para Chrome con soporte de instalación por DevTools, usa `CHROME_CDP_INSTALL=1`. Los paquetes de esta prueba deben apuntar a la API local.

Si el backend ya está funcionando, selecciona un puerto local libre con `CATALOG_URL` y un directorio temporal con `EXTENSION_OUT_DIR`. Usa ambos valores para compilar los paquetes de prueba y ejecutar `bun tests/browser.ts`.

| Prueba | Resultado de la entrega |
| --- | --- |
| Frases ficticias reservadas en inglés | 12 de 12 spoilers graves detectados y 0 de 20 textos inocuos ocultos. |
| Frases ficticias reservadas en español | 12 de 12 spoilers graves detectados y 0 de 20 textos inocuos ocultos. |
| Campaña con interrupción | 120 revisiones programadas, 117 completadas, 3 omitidas y ningún acceso a fuentes después del cierre. |
| Chrome 157 y Firefox 160 | Cinco adaptadores por navegador. Se verificaron el árbol o los nombres accesibles, teclado, pausa de vídeo, navegación sin recarga, reciclaje de tarjetas, progreso y funcionamiento sin conexión. |
| Tráfico del catálogo | 20 peticiones GET durante la prueba de los dos navegadores. El único parámetro observado fue el cursor. Todas las peticiones llegaron sin cookies ni referencia de navegación. |
| Búsqueda HNSW | Una prueba independiente creó el índice en PostgreSQL con pgvector bajo PGlite, comprobó el plan de ejecución y recuperó el evento en inglés con una consulta en español. |
| Evidencias y distribución | Se comprobaron duplicados, traducciones, inversión de participantes, negaciones, cuotas, rectificación y retiradas incrementales. |

La prueba HNSW se reproduce con `bun tests/hnsw.ts` y `@electric-sql/pglite` con soporte de pgvector. `PGLITE_DIR` permite usar un paquete ya instalado.

Las cifras de detección describen tres eventos ficticios y 64 frases. Falta medir el rendimiento con publicaciones reales. La prueba de integración de .NET pasó con pgvector nativo y respuestas controladas de las fuentes, incluido el título público de un tráiler. La puesta en marcha local también procesó entradas reales de GameSpot con Gemini. Quedan pendientes las cinco redes en vivo y una lectura manual con tecnología de asistencia. Los feeds solo permiten recuperar las entradas que todavía ofrecen. Reddit y YouTube vuelven a consultar los identificadores conocidos para detectar ediciones posteriores. La disponibilidad del material depende de las ventanas y cuotas de cada proveedor. [Tráiler de referencia](https://www.youtube.com/watch?v=QdBZY2fkU-0)

