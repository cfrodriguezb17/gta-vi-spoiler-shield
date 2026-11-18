![GTA VI Spoiler Shield al atardecer](docs/media/social-preview.jpg)

# GTA VI Spoiler Shield

[English](README.md) · [Arquitectura](docs/architecture.md) · [Privacidad](docs/privacy.md)

Oculta posibles spoilers de GTA VI en Reddit, YouTube, X, Facebook e Instagram. El aviso cubre el texto y la miniatura y permite revelar una sola publicación con **Mostrar**.

| Preventivo · predeterminado | Inteligente | Combinado |
| --- | --- | --- |
| Cubre publicaciones y respuestas claramente relacionadas con GTA VI desde la instalación. | Compara el contenido en español o inglés con los eventos del catálogo local. Reconoce caracteres alterados y conserva la última copia al perder conexión. | Cubre lo que detecta el modo preventivo y busca coincidencias con la historia aunque se omita el nombre del juego. También cubre afirmaciones breves sobre la muerte de un protagonista como posibles spoilers. |

<img src="docs/media/panel.png" alt="Panel en español con idioma, modo y redes protegidas" width="320">

![Aviso de spoiler con el botón Mostrar](docs/media/covered.png)

## Instalación

Descarga `chrome.zip` o el archivo firmado `firefox.xpi` desde la [última versión de GitHub](https://github.com/cfrodriguezb17/gta-vi-spoiler-shield/releases/latest). Para compilar desde el código fuente, sigue la [guía de desarrollo](docs/development.es.md).

- **Chrome de escritorio** — Extrae `chrome.zip` en una carpeta permanente. En `chrome://extensions` activa el modo de desarrollador, pulsa **Cargar descomprimida** y selecciona la carpeta. Para actualizar, reemplaza los archivos en esa misma ruta y pulsa **Recargar**.
- **Firefox de escritorio** — Abre el archivo `.xpi` firmado desde Firefox y confirma la instalación. Para actualizar, instala el nuevo XPI sobre el anterior. Requiere Firefox 140 o posterior.
- Recarga las pestañas abiertas. El panel permite elegir idioma, modo y redes. Las imágenes y los videos, incluidos los Shorts en las búsquedas de YouTube, se evalúan mediante el texto y las etiquetas de su tarjeta. Los spoilers con pocas pistas pueden quedar visibles.

[API](docs/api.md) · [Operación](docs/operations.md) · [Contribuir](CONTRIBUTING.md) · [Seguridad](SECURITY.md) · [Cambios](CHANGELOG.md)

Proyecto independiente de aficionados. El código se distribuye bajo MIT. Las atribuciones del material de terceros se recogen en [los créditos](NOTICE.md).
