import { generateQrSvgDataUrl } from './qr-code';

/** A printed board link must survive edits and work when scanned off-device. */
export function publicBoardQrUrl(boardId: string): string {
  return `https://www.livingwiki.com/boards/${encodeURIComponent(boardId)}?view=stack`;
}

export function publicBoardQrImageUrl(boardId: string): string {
  return generateQrSvgDataUrl(publicBoardQrUrl(boardId));
}
