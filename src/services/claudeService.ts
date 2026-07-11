/**
 * claudeService.ts
 *
 * En modo uso propio, el "rol de Claude" (preprocesado para TTS, contexto de
 * capítulos y chat) lo cubre un LLM open vía Hugging Face Inference Providers,
 * con el endpoint OpenAI-compatible del router. El token vive en apiKeys.ts
 * (gitignoreado), nunca en el repo.
 *
 * El nombre del archivo se mantiene por compatibilidad con los imports existentes.
 */

import { HF_TOKEN } from '../config/apiKeys';

const HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions';

// Modelo para preprocesado/contexto (tareas de edición y extracción).
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct';
// Modelo para el chat compañero (mismo por ahora; se puede subir/bajar).
const CHAT_MODEL = 'meta-llama/Llama-3.3-70B-Instruct';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChapterContextResult = {
  beforeSummary: string;
  afterSummary: string;
  characters: string[];
  keyEvents: string[];
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: unknown;
};

async function callClaude(
  systemPrompt: string,
  messages: ChatMessage[],
  model = MODEL,
  maxTokens = 1024,
): Promise<string> {
  const response = await fetch(HF_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // El endpoint es OpenAI-compatible: el system va como primer mensaje.
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM proxy error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Preprocesa texto crudo de PDF para que suene natural en TTS.
 * Limpia artefactos de conversión y normaliza para audio.
 */
export async function preprocessTextForTTS(rawText: string): Promise<string> {
  const systemPrompt = `Eres un editor de texto especializado en preparar texto literario para síntesis de voz.
Tu tarea es limpiar y normalizar el texto que recibirás para que suene natural cuando lo lea un TTS.

Reglas:
- Une palabras cortadas con guión al final de línea (recor-\ndar → recordar)
- Reemplaza los "—dijo fulano—" por pausas naturales sin perder el diálogo
- Normaliza puntuación: los puntos suspensivos (...) deben quedar como "..." sin espacios raros
- Convierte números a texto cuando corresponda (siglo XIV → siglo catorce, pero "1996" queda igual)
- Elimina referencias de pie de página como "www.lectulandia.com - Página 42"
- Elimina encabezados de capítulo repetidos (el título del capítulo al inicio)
- Mantén los diálogos exactamente como están, solo limpiando artefactos técnicos
- NO summarices ni cambies el contenido, solo limpia artefactos técnicos
- Retorna SOLO el texto limpio, sin explicaciones`;

  // max_tokens debe alcanzar para devolver el tramo completo (~3600 chars ≈ ~1300 tokens).
  return callClaude(systemPrompt, [{ role: 'user', content: `Limpia este texto para TTS:\n\n${rawText}` }], MODEL, 2048);
}

/**
 * Extrae contexto de un capítulo para el sistema de acompañamiento de saga.
 * NUNCA tiene acceso a capítulos futuros (anti-spoiler).
 */
export async function extractChapterContext(
  chapterText: string,
  previousContextSummary: string,
  chapterTitle: string,
): Promise<ChapterContextResult> {
  const systemPrompt = `Eres un asistente de lectura para la saga "Canción de Hielo y Fuego" de George R.R. Martin.
Tu tarea es analizar UN capítulo y generar información útil para el lector.

IMPORTANTE: Solo tienes acceso al capítulo que se te da. No hagas spoilers de lo que viene después.
Responde siempre en español.
Responde SOLO con JSON válido, sin texto adicional.`;

  const userContent = `Capítulo: ${chapterTitle}
Contexto previo acumulado: ${previousContextSummary || 'Inicio de la saga'}

Texto del capítulo:
${chapterText.slice(0, 16000)} ${chapterText.length > 16000 ? '...[capítulo continúa]' : ''}

Genera un JSON con exactamente esta estructura:
{
  "beforeSummary": "2-3 oraciones de qué recordar antes de leer este capítulo (basado en contexto previo)",
  "afterSummary": "3-5 oraciones resumiendo lo más importante que pasó en este capítulo",
  "characters": ["nombre1", "nombre2", "nombre3"],
  "keyEvents": ["evento 1 breve", "evento 2 breve", "evento 3 breve"]
}`;

  const rawResponse = await callClaude(systemPrompt, [{ role: 'user', content: userContent }]);

  try {
    const jsonMatch = /\{[\s\S]+\}/.exec(rawResponse);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]) as ChapterContextResult;

    return {
      beforeSummary: parsed.beforeSummary ?? '',
      afterSummary: parsed.afterSummary ?? '',
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      keyEvents: Array.isArray(parsed.keyEvents) ? parsed.keyEvents : [],
    };
  } catch {
    return {
      beforeSummary: '',
      afterSummary: rawResponse.slice(0, 500),
      characters: [],
      keyEvents: [],
    };
  }
}

/**
 * Chat multi-turn con contexto acumulado de la saga.
 */
export async function chatWithSagaContext(
  messages: ChatMessage[],
  sagaContext: string,
  bookTitle: string,
): Promise<string> {
  const systemPrompt = `Sos el asistente de lectura personal para "${bookTitle}" de la saga Canción de Hielo y Fuego.
Conocés en detalle todo lo que el lector ya leyó, pero NUNCA revelás spoilers de lo que viene después.

Contexto de lo leído hasta ahora:
${sagaContext}

Reglas:
- Respondé siempre en español rioplatense (vos, te, tu)
- Podés hacer referencias exactas a capítulos, escenas y personajes ya leídos
- Si te preguntan algo de capítulos que el lector no leyó todavía, avisale sin revelar nada
- Sé conciso pero preciso. Máximo 3-4 párrafos por respuesta salvo que el lector pida más
- Si el lector quiere analizar un personaje o escena, podés extenderte con análisis literario`;

  return callClaude(systemPrompt, messages, CHAT_MODEL, 2048);
}
