# Bardo — identidad de marca "Tinta y lacre"

**Fecha:** 2026-09-22 · **Decidido por Facu** · Reemplaza la paleta índigo/ámbar (defaults de Tailwind).

**Idea:** tinta sobre papel y el lacre que sella la carta. Literario, calmo, cálido, pensado para leer
de noche. Un solo color accionable (tinta) y un solo color de avance/importancia (lacre).

Todos los pares se verificaron con la fórmula WCAG: texto ≥ 4,5:1, elementos de UI ≥ 3:1.

## Tokens — pegar en `src/utils/theme.ts`

Mismos nombres que hoy, así no cambia ningún consumidor. `warm` pasa de ámbar a **lacre**.

```ts
export const lightColors = {
  background: '#F6F2EA',   // papel
  surface: '#FFFDF8',
  surfaceMuted: '#EDE7DB',
  readerSurface: '#FFFFFF', // SIN CAMBIO: tiene que coincidir con PdfPageList y BardoPdfModule.kt
  readerAccent: '#ECE8F6',
  text: '#1F1C2C',          // 14,9:1 sobre background
  textMuted: '#655F72',     // 5,5 / 5,0 sobre surfaceMuted
  border: '#DDD4C4',
  primary: '#3A3785',       // tinta — 9,1 sobre background
  primaryText: '#FFFFFF',   // 10,2 sobre primary
  accent: '#E3E1F4',        // tinte suave de selección
  warm: '#B8492E',          // lacre — 4,7 sobre background (antes ámbar 1,99 ✗)
  warmSoft: '#F6E1D8',
  success: '#2F7A4B',       // 5,2 (antes 3,3 ✗)
  danger: '#A61E4D',        // frambuesa, distinto del lacre — 7,1 (antes 3,9 ✗)
  highlight: '#F4D8CB',
  highlightText: '#5A1E0E', // 9,6
  shadow: 'rgba(31, 28, 44, 0.10)',
  scrim: 'rgba(20, 18, 30, 0.45)',
};

export const darkColors = {
  background: '#131218',
  surface: '#1C1B23',
  surfaceMuted: '#26242F',
  readerSurface: '#121212', // SIN CAMBIO (nativo)
  readerAccent: '#25233A',
  text: '#EEE9DF',          // 15,4
  textMuted: '#A9A3B4',     // 7,6
  border: '#34313F',
  primary: '#A7A3F2',       // 8,1
  primaryText: '#16143A',   // 7,7
  accent: '#2C2A55',
  warm: '#E8876A',          // 7,2
  warmSoft: '#3A2019',
  success: '#6FCF97',
  danger: '#F28BA8',
  highlight: '#5C2A1C',
  highlightText: '#FFE3D8', // 9,6
  shadow: 'rgba(0, 0, 0, 0.35)',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const sepiaColors: ThemeColors = {
  ...lightColors,           // tinta sobre papel viejo: el primary índigo-tinta queda bien acá (8,6)
  background: '#EFE6D0',
  surface: '#F7F0DC',
  surfaceMuted: '#E9DFC6',
  readerSurface: '#F4ECD8', // SIN CAMBIO (nativo)
  readerAccent: '#E6DCC0',
  text: '#433422',
  textMuted: '#6E5E49',     // 5,0 (antes #7A6A55 = 4,2 ✗)
  border: '#DDD0B3',
  accent: '#E2D6B8',
  warm: '#A8412A',          // 5,2
  highlight: '#EBCDB5',
  highlightText: '#4A2410',
};
```

Los papeles del lector (`#FFFFFF` / `#F4ECD8` / `#121212`) **no cambian** a propósito: están
duplicados en `PdfPageList.tsx` (`PAGE_BACKGROUND`) y en el tintado nativo de `BardoPdfModule.kt`,
y tocarlos obliga a build nueva. Queda como deuda: que salgan de un solo lugar.

## Colores fuera del tema — reemplazar

| Archivo | Hoy | Pasa a |
|---|---|---|
| `src/components/AppErrorBoundary.tsx` | paleta vieja PDFacuReader (`#f7f4ee`, `#253038`, `#5a6870`, `#6b9f98`) | `lightColors.background / text / textMuted / primary` |
| `app/_layout.tsx` | `#4F46E5` (spinner), `#F5F6FB`, `#14172B`, `#f6e8e6`, `#8f4a43` | `primary`, `background`, `text`, `warmSoft`, `danger` |
| `src/components/BookGridItem.tsx` | corazón `#FF5C7A` | `colors.warm` |
| `src/components/BookGridItem.tsx` | badge `rgba(20,23,43,0.72)` | `rgba(31,28,44,0.72)` |
| `src/components/BookGridItem.tsx` | `GENERATED_COVER_COLORS` (arcoíris Tailwind) | ver abajo |

**Portadas generadas** (todas ≥ 4,9:1 con texto blanco):
`['#3A3785', '#B8492E', '#2F5E57', '#8A6D1F', '#5A2A52', '#3E5C7A', '#7A4B2A', '#4B5563']`
— tinta, lacre, bosque, ocre, ciruela, pizarra, cuero, grafito.

Los overlays negros translúcidos del lector (`rgba(20,20,20,…)`, `#ffffff` sobre ellos) están bien:
van encima de la página, no son marca.

## app.json

- `splash.backgroundColor` y `android.adaptiveIcon.backgroundColor`: `#4F46E5` → **`#231F5C`** (ver Ícono)
- Agregar `"primaryColor": "#3A3785"` (hoy `colors.xml` queda con `#023c69`, el default de Expo)
- Agregar `"backgroundColor": "#F6F2EA"` (fondo de la ventana antes del primer render)

## Tipografía

- **Ícono:** Outfit ExtraBold, solo la "b" (ya convertida a trazo: no hay que cargar la fuente).
- **Wordmark y títulos de marca:** **Lora** Bold (serif, OFL). Solo "Bardo" en la cabecera del Inicio
  y títulos grandes; el resto de la UI sigue con la fuente del sistema.
- Cargar con `expo-font` (plugin en `app.json`, se embebe en la build: sin carga en runtime).
  Solo el peso Bold → ~ 100 KB.
- La opción "Serif" del lector **no cambia**.

## Ícono — "b." sobre tarjeta de vidrio (elegido por Facu, 2026-09-22)

La "b." de Bardo (Outfit ExtraBold, convertida a trazo) en blanco sobre una tarjeta de vidrio
esmerilado que ocupa el **74 %** del ícono. El punto es una esfera lacre con brillo. Fondo:
degradé "atardecer" `#231F5C → #4A2E72 → #C85A45` con dos manchas difusas (lacre y violeta).
Exploración completa en `docs/brand/exploracion/`; verificación en `docs/brand/icono-final-check.png`.

| Archivo | Tamaño | Notas |
|---|---|---|
| `assets/icon.png` | 1024 | cuadrado, sin transparencia |
| `assets/android-icon-background.png` | 1024 | capa 108 dp: degradé + manchas |
| `assets/android-icon-foreground.png` | 1024 | capa 108 dp: tarjeta + b. (transparente afuera); la b entra en la zona segura de 66 dp |
| `assets/android-icon-monochrome.png` | 1024 | "b." blanca sobre transparente |
| `assets/splash-icon.png` | 1024 | ícono redondeado sobre transparente |
| `assets/favicon.png` | 256 | |
| `icon_512.png`, `feature_graphic.png` | 512 / 1024×500 | tienda |
| `assets/brand-mark.png` | 120 | miniatura del ícono para la cabecera del Inicio (34 pt) |
| `assets/fonts/Lora-Bold.ttf` | — | wordmark, embebida con el plugin `expo-font` |

**app.json:** como el ícono usa el degradé, el color de splash y del adaptativo pasa a
**`#231F5C`** (el tono de arriba del degradé), no `#3A3785`. `primaryColor` sigue `#3A3785`.
