# Bardo vs ReadEra — estudio de uso y comodidad

**Fecha:** 2026-09-21. **Fuente ReadEra:** teardown del APK 26.05 (`readera.md`) y uso de la app. **Objetivo:** que Bardo sea igual de claro y cómodo, con identidad propia.

## 1. Qué hace cómoda a ReadEra (y qué copiamos del principio, no de la forma)

| Principio de ReadEra | Cómo se ve en ReadEra | Cómo queda en Bardo (hecho hoy) |
|---|---|---|
| **Una acción por lugar, siempre en el mismo lugar** | Barra inferior del lector con Contenidos · Buscar · Ajustes · Leer en voz alta. Nunca cambia. | Barra inferior fija: **Índice · Buscar · Aspecto · Voz · Pantalla**. El play vive en un botón flotante, siempre abajo a la derecha. |
| **Tocar la página muestra u oculta todo** | Un tap centra el modo inmersivo; los controles no invaden. | Igual (ya existía). En pantalla completa solo queda un chip discreto con "% · página" o "% · capítulo". |
| **El índice es un toque, no un viaje** | "Contents" abre el índice con el capítulo actual marcado y el número de página. | Hoja "Índice" en el lector, capítulo actual resaltado, página o porcentaje a la derecha, scroll ya posicionado. Antes había que ir a "Sobre este libro". |
| **La biblioteca es visual y filtrable** | Portadas grandes, etiqueta de formato, progreso, listas (Leyendo / Por leer / Leídos / Favoritos / Colecciones). | Portadas con **etiqueta de formato** (PDF · EPUB · CÓMIC), barra de progreso ámbar, tilde verde de leído, corazón de favorito; chips de filtro con ícono; **+** flotante para abrir archivos. |
| **Seguir leyendo es lo primero** | La app abre en el último libro. | Tarjeta "Seguir leyendo" con tapa, autor, progreso y dos botones: **Continuar** y **Escuchar**. (Y la opción de reabrir solo al iniciar sigue en Ajustes.) |
| **Ajustes ordenados por lo que hacés, no por lo que son técnicamente** | Grupos claros; cada fila con título y explicación corta. | Ajustes en 5 grupos: **Lectura → Voz → Biblioteca → Almacenamiento → Acerca de**, filas con ícono, título, explicación y control a la derecha. Sin textos de bienvenida. |
| **Íconos reconocibles, no emojis** | Material icons. | Ionicons en toda la app; los emojis se fueron. |
| **Colores con jerarquía** | Un acento para lo accionable; el resto neutro. | **Índigo** para lo accionable (botones, play, selección), **ámbar** para avance e importancia (progreso, marcadores, estrellas, barra de páginas). La superficie de lectura sigue calma (blanco / sepia / negro). |

## 2. Estructura final de Bardo

```
Inicio
├─ Cabecera: marca "Bardo" · ⚙ Ajustes
├─ (si suena algo) banda índigo "Reproduciendo ahora" → vuelve al libro · ■
├─ Seguir leyendo: tapa · título · autor · progreso · [Continuar] [Escuchar]
├─ Biblioteca · N libros
│  ├─ chips: Todos · Leyendo · Para leer · Leídos · Favoritos · (colecciones)
│  ├─ carpetas escaneadas (plegables) → grilla de portadas
│  └─ Otros libros → grilla
└─ + flotante: abrir archivo

Lector
├─ Cabecera: ← · título · 🔖 marcador · ⓘ sobre este libro
├─ Página / texto (tap = pantalla completa)
│  ├─ barra de páginas (PDF/cómic) con "n / N"
│  ├─ transporte de audio (■ ◀15 velocidad 15▶) solo cuando hay audio
│  └─ ▶ flotante
├─ Barra inferior: Índice · Buscar · Aspecto · Voz · Pantalla
└─ Hojas: Índice (capítulos) · Aspecto (tema, letra, atenuar, márgenes) · Voz (velocidad, temporizador, voz, capítulo ±)

Sobre este libro
├─ tapa · título · autor · formato · progreso · [Leer] [Escuchar]
├─ Mi lista (Para leer · Leído · Favorito)
├─ Mi reseña (estrellas ámbar + texto)
├─ Colecciones
├─ Índice
└─ Marcadores, citas y notas

Ajustes
├─ Lectura: tema · tamaño de letra · recortar márgenes · pantalla encendida · reabrir último · modo oscuro
├─ Voz: voz · velocidad · probar · instalar más voces
├─ Biblioteca: carpetas escaneadas · excluidas · libros ocultos
├─ Almacenamiento: borrar caché
└─ Acerca de: versión · sin conexión · formatos
```

## 3. Lo que se sumó después del estudio (misma noche)

- **Voz lista antes de tocar play.** Al abrir un libro con texto, el primer tramo desde la posición actual se sintetiza en silencio; play suena al instante. ReadEra tarda lo que tarda el motor.
- **Buscar en la biblioteca** (título, autor o archivo, sin tildes) y **ordenar** por Recientes · Título · Autor. Ambos en la cabecera del Inicio.
- **Tipografía del modo texto:** interlineado (1,3–2,0), Sans/Serif, justificado. En Aspecto (lector) y en Ajustes.
- **Leer un PDF como texto corrido** (reflow): chips "Páginas / Texto corrido" en Aspecto, y ajuste global. Cambiar de modo conserva la posición. Solo PDF con texto (no escaneos ni cómics).

## 4. Lo que ReadEra tiene y Bardo todavía no (comodidad, no formatos)

Ordenado por lo que más se usa en el día a día:

1. **Zoom con los dedos** en páginas y cómics, y ajustar a ancho/alto.
2. **Márgenes** de página configurables y familias de fuente propias (hoy: Sans o Serif del sistema).
3. **Pasar de página con las teclas de volumen** y por toques en los bordes.
4. **Paso de página horizontal** (animación de hoja) como alternativa al scroll continuo.
5. **Selección de texto** para citar exacto, buscar en el diccionario o traducir.
6. **Reflow con imágenes**: el modo texto de un PDF hoy es solo texto (las imágenes quedan en el modo páginas).
7. **Auto-scroll** con velocidad.
8. **Biblioteca:** agrupar por autor y serie, tiempo restante de lectura.
9. **Explorar carpetas** del teléfono desde la app, renombrar y borrar archivos.
10. **Vocabulario personal**, modo infantil, pantalla dividida, sincronización.

Y dos cosas donde Bardo ya está por delante de la versión gratuita de ReadEra: voz con pantalla bloqueada y saltear encabezados repetidos.

## 5. Identidad

- **Nombre:** Bardo (el que cuenta y canta historias: la app lee y narra).
- **Paleta:** índigo `#4F46E5` / ámbar `#F59E0B` sobre `#F5F6FB`; en oscuro `#8C86FF` / `#FBBF24` sobre `#0F1117`.
- **Ícono:** pendiente. El actual es el de "PDF reader" (una R con hojas y un play) y ya no representa a la app. El pedido con especificaciones (tamaños, zona segura del ícono adaptativo, monocromo, splash) quedó en el buzón del hub para Cowork.
- **Lo que no cambia:** el package `com.personal.pdfvoicereader` y el slug de EAS `pdf-voice-reader` (invisibles; cambiarlos obliga a reinstalar como app nueva y a re-vincular EAS).
