# PReader — Plan de Evolución con IA

## El proyecto hoy
App móvil en **React Native + Expo + TypeScript** que extrae texto de PDFs y lo convierte en audio.

**Problema principal:** `expo-speech` usa el TTS del sistema operativo → audio robótico y trabado.

---

## El problema raíz

```
expo-pdf-text-extract → texto crudo → expo-speech (TTS del sistema) → audio robótico
```

El texto del PDF llega con saltos de línea raros, palabras cortadas con guión, puntuación mal posicionada. El TTS lo lee tal cual, sin entenderlo.

---

## El flujo nuevo

```
PDF
  ↓
expo-pdf-text-extract (ya funciona ✓)
  ↓
Claude API → limpia, normaliza y prepara el texto
  ↓
OpenAI TTS API → genera audio .mp3 natural
  ↓
expo-audio (ya instalado ✓) → reproduce
```

---

## Stack definitivo

| Capa | Tecnología | Estado |
|------|-----------|--------|
| App móvil | React Native + Expo + TypeScript | ✅ Ya existe |
| Extracción PDF | expo-pdf-text-extract | ✅ Ya funciona |
| Reproducción audio | expo-audio | ✅ Ya instalado |
| Preprocesamiento | **Claude API** | 🔜 Agregar |
| Text-to-Speech | **OpenAI TTS API** | 🔜 Reemplaza expo-speech |

**No hay dependencias nuevas que instalar** — solo llamadas a APIs con fetch.

---

## Qué hace Claude en el flujo

Antes de enviar el texto al TTS, Claude:

- Une palabras cortadas por guión (`recor-\ndar` → `recordar`)
- Normaliza puntuación para pausas naturales
- Convierte diálogos (`—dijo María—`) en formato hablable
- Agrega marcadores de pausa entre escenas y capítulos
- Convierte números, siglas y abreviaturas a texto hablable
- Identifica narración vs diálogo

---

## Features por capítulo (para sagas densas)

Cada vez que el usuario carga un capítulo, Claude genera automáticamente:

**Antes de escuchar:**
- Personajes que aparecen
- Qué recordar del capítulo anterior

**Después de escuchar:**
- Resumen de lo importante
- Glosario de términos complejos si los hay

---

## Compañero de lectura (chat contextual)

Mientras escucha, el usuario puede pausar y preguntar:
- *"¿Quién es este personaje?"*
- *"¿Qué pasó antes con esto?"*

Claude responde usando el texto completo del PDF como contexto, **sin hacer spoilers** del punto donde está el lector.

---

## Feature futuro — Recap visual (cómic)

Al terminar cada capítulo, la app genera un recap de 4-6 paneles en formato cómic:

- Claude genera el guión y los diálogos condensados
- Flux / DALL-E genera las ilustraciones de cada panel
- Se muestra como resumen visual antes del siguiente capítulo

> Esta es la feature más ambiciosa y se construye sobre todo lo anterior.

---

## Prioridades de implementación

1. **Reemplazar expo-speech por OpenAI TTS** → fix inmediato del audio robótico
2. **Integrar Claude para preprocesamiento** → texto limpio = audio fluido
3. **Guías por capítulo** → convierte la app en experiencia de lectura guiada
4. **Chat contextual** → compañero de lectura sin spoilers
5. **Recap visual en cómic** → feature premium diferenciadora
