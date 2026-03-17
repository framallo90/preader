import { TextBlock } from '../types/document';

const TARGET_BLOCK_LENGTH = 280;
const HARD_BLOCK_LENGTH = 420;
const MIN_BLOCK_LENGTH = 110;

function splitIntoSentences(paragraph: string) {
  const matches = paragraph.match(/[^.!?]+[.!?]+[\])'"»”]*|[^.!?]+$/g);
  return matches?.map((sentence) => sentence.trim()).filter(Boolean) ?? [paragraph];
}

function findSplitPoint(value: string, maxLength: number) {
  const slice = value.slice(0, maxLength);
  const preferredSplit = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('; '),
    slice.lastIndexOf(', '),
    slice.lastIndexOf(' '),
  );

  return preferredSplit > 80 ? preferredSplit + 1 : maxLength;
}

function chunkLongSentence(sentence: string) {
  const parts: string[] = [];
  let remaining = sentence.trim();

  while (remaining.length > HARD_BLOCK_LENGTH) {
    const splitPoint = findSplitPoint(remaining, HARD_BLOCK_LENGTH);
    parts.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

export function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\n([A-Za-zÀ-ÖØ-öø-ÿ])/g, '$1$2')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildTextBlocks(fullText: string): TextBlock[] {
  if (!fullText.trim()) {
    return [];
  }

  const paragraphs = fullText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const blockTexts: string[] = [];
  let currentBlock = '';

  for (const paragraph of paragraphs) {
    const sentences = splitIntoSentences(paragraph);

    for (const sentence of sentences) {
      const chunks = chunkLongSentence(sentence);

      for (const chunk of chunks) {
        const nextCandidate = currentBlock ? `${currentBlock} ${chunk}` : chunk;

        if (nextCandidate.length <= TARGET_BLOCK_LENGTH || currentBlock.length < MIN_BLOCK_LENGTH) {
          currentBlock = nextCandidate;
          continue;
        }

        blockTexts.push(currentBlock.trim());
        currentBlock = chunk;
      }
    }

    if (currentBlock) {
      blockTexts.push(currentBlock.trim());
      currentBlock = '';
    }
  }

  if (currentBlock) {
    blockTexts.push(currentBlock.trim());
  }

  if (blockTexts.length === 0) {
    blockTexts.push(fullText.trim());
  }

  let cursor = 0;

  return blockTexts.map((text, index) => {
    const startChar = fullText.indexOf(text, cursor);
    const safeStartChar = startChar >= 0 ? startChar : cursor;
    const endChar = safeStartChar + text.length;

    cursor = endChar;

    return {
      index,
      text,
      startChar: safeStartChar,
      endChar,
    };
  });
}
