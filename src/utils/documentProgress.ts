import { ParsedDocument } from '../types/document';
import { clamp } from './math';

export function getAbsoluteCharIndex(
  document: ParsedDocument | null,
  blockIndex: number,
  charIndex: number,
) {
  if (!document || document.blocks.length === 0 || document.fullText.length === 0) {
    return 0;
  }

  const safeBlockIndex = clamp(blockIndex, 0, document.blocks.length - 1);
  const block = document.blocks[safeBlockIndex];
  const safeCharIndex = clamp(charIndex, 0, block.text.length);

  return clamp(block.startChar + safeCharIndex, 0, document.fullText.length);
}

export function getPositionFromAbsoluteChar(
  document: ParsedDocument | null,
  absoluteCharIndex: number,
) {
  if (!document || document.blocks.length === 0 || document.fullText.length === 0) {
    return {
      absoluteCharIndex: 0,
      blockIndex: 0,
      charIndex: 0,
      percentage: 0,
    };
  }

  const safeAbsoluteCharIndex = clamp(absoluteCharIndex, 0, document.fullText.length);

  let low = 0;
  let high = document.blocks.length - 1;
  let selectedIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = document.blocks[mid];

    if (safeAbsoluteCharIndex < block.startChar) {
      high = mid - 1;
      continue;
    }

    if (safeAbsoluteCharIndex > block.endChar) {
      selectedIndex = mid;
      low = mid + 1;
      continue;
    }

    selectedIndex = mid;
    break;
  }

  const selectedBlock = document.blocks[selectedIndex];
  const charIndex = clamp(
    safeAbsoluteCharIndex - selectedBlock.startChar,
    0,
    selectedBlock.text.length,
  );

  return {
    absoluteCharIndex: safeAbsoluteCharIndex,
    blockIndex: selectedIndex,
    charIndex,
    percentage: Number(((safeAbsoluteCharIndex / document.fullText.length) * 100).toFixed(2)),
  };
}
