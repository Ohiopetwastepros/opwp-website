import { decode } from 'fast-png';
import encode from 'jpeg-js/lib/encoder.js';
import { REVIEW_PREVIEW_WIDTH, REVIEW_PREVIEW_HEIGHT } from './review-preview-token.mjs';

export const REVIEW_PREVIEW_MAX_BYTES = 1_000_000;
const TARGET_BYTES = 400_000;

// Pure JavaScript codecs run in Workers without native Node image libraries.
// Only the trusted, fixed-size compositor output is decoded here.
export function reviewPreviewJpeg(pngBytes) {
  const image = decode(pngBytes, { checkCrc: true });
  if (image.width !== REVIEW_PREVIEW_WIDTH || image.height !== REVIEW_PREVIEW_HEIGHT || image.depth !== 8 || image.channels !== 4) {
    throw new Error('Invalid review preview dimensions or pixels');
  }
  for (const quality of [82, 72, 62]) {
    const bytes = new Uint8Array(encode(image, quality).data);
    if (bytes.byteLength <= TARGET_BYTES || (quality === 62 && bytes.byteLength < REVIEW_PREVIEW_MAX_BYTES)) {
      return { bytes, contentType: 'image/jpeg' };
    }
  }
  throw new Error('Review preview exceeds the JPEG size limit');
}
