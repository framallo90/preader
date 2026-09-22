/**
 * Resumen corto de un libro a partir de su propio texto.
 *
 * No inventa nada: son las primeras oraciones de la PROSA, salteando lo que
 * viene antes (portadilla, créditos, "Proyecto Gutenberg", índice). Sirve para
 * que en la ficha se vea de qué va un libro que no trae sinopsis, que es la
 * mayoría de los TXT, los DOCX y los PDF escaneados.
 */
import { paragraphSpans, trimSpan } from './textSpans';

/** Largo máximo del resumen. Más que esto ya no se lee de un vistazo. */
const MAX_SUMMARY = 320;
/** Un párrafo más corto que esto es un título o una línea suelta, no prosa. */
const MIN_PARAGRAPH = 120;
/** Cuántos párrafos del principio se miran antes de darse por vencido. */
const MAX_LOOKAHEAD = 40;

// Líneas de los preliminares: no son el libro.
const FRONT_MATTER = [
  /proyecto gutenberg|project gutenberg/i,
  /derechos reservados|todos los derechos|copyright|\(c\)\s*\d{4}|©/i,
  /isbn|dep[oó]sito legal|primera edici[oó]n|editorial\b/i,
  /^[íi]ndice\b|^tabla de contenido|^contents?$/i,
  /traducci[oó]n de|ilustraciones de|dise[ñn]o de (tapa|cubierta)/i,
];

function looksLikeFrontMatter(text: string): boolean {
  return FRONT_MATTER.some((pattern) => pattern.test(text));
}

/** Un párrafo TODO en mayúsculas es un título, no el cuerpo del libro. */
function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return false;
  return letters === letters.toUpperCase();
}

/** Corta en el último fin de oración que entre; si no hay, en la última palabra. */
function cutNicely(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (sentence > limit * 0.5) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * Resumen automático, o null si el libro no da para uno (muy corto, o todo
 * preliminares). Nunca devuelve algo que no esté tal cual en el texto.
 */
export function buildAutoSummary(fullText: string): string | null {
  if (!fullText || fullText.length < MIN_PARAGRAPH) return null;

  const paragraphs = paragraphSpans(fullText);
  for (let i = 0; i < Math.min(paragraphs.length, MAX_LOOKAHEAD); i++) {
    const span = trimSpan(fullText, paragraphs[i].start, paragraphs[i].end);
    if (!span) continue;
    const text = fullText.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
    if (text.length < MIN_PARAGRAPH) continue;
    if (isAllCaps(text)) continue;
    if (looksLikeFrontMatter(text)) continue;
    return cutNicely(text, MAX_SUMMARY);
  }
  return null;
}

/**
 * Lo que escriben las herramientas en el campo de descripción cuando el autor no
 * puso nada. No es una sinopsis y no sirve de resumen: mejor las primeras líneas
 * del libro.
 */
const TOOL_SIGNATURE = [
  /^(generated|created|produced)\s+(by|with|using)\b/i,
  /^microsoft\s+word\b|^libreoffice\b|^openoffice\b|^pages\b/i,
  /^(pdf|epub|doc|docx)\s*(creator|producer|writer)\b/i,
  /^converted\s+(by|from|with)\b/i,
  /^calibre\b|^pandoc\b|^python-docx\b|^reportlab\b|^ghostscript\b/i,
  /^untitled\b|^sin t[ií]tulo\b|^documento\d*$/i,
];

function looksLikeToolSignature(text: string): boolean {
  return TOOL_SIGNATURE.some((pattern) => pattern.test(text));
}

/** Limpia una sinopsis que vino en la metadata del archivo (puede traer HTML). */
export function cleanMetadataSummary(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 20) return null;
  if (looksLikeToolSignature(text)) return null;
  return cutNicely(text, MAX_SUMMARY);
}
