import type { BatchReceipt, Receipt } from '@varve/automation';

export const IMAGE_PLACEHOLDER = '[delivered as image content]';

export interface OutputImage {
  mimeType: string;
  bytes: number;
  data: string;
}

/**
 * A command that returns pixels puts them in `output.image`. MCP has a content
 * type for exactly that, so the pixels travel once, as image content, and the
 * JSON copies carry a placeholder. Leaving the base64 in both the text and the
 * structured result would put the same megabytes in a model's context three
 * times.
 */
export function extractImage(receipt: Receipt | BatchReceipt): {
  stripped: Receipt | BatchReceipt;
  image: OutputImage | null;
} {
  const output = (receipt as { output?: unknown }).output;
  if (!output || typeof output !== 'object') return { stripped: receipt, image: null };
  const candidate = (output as { image?: unknown }).image as Partial<OutputImage> | undefined;
  if (
    !candidate ||
    typeof candidate.data !== 'string' ||
    typeof candidate.mimeType !== 'string' ||
    !candidate.mimeType.startsWith('image/')
  ) {
    return { stripped: receipt, image: null };
  }
  const image: OutputImage = {
    mimeType: candidate.mimeType,
    bytes: typeof candidate.bytes === 'number' ? candidate.bytes : 0,
    data: candidate.data,
  };
  const stripped = {
    ...receipt,
    output: { ...(output as object), image: { ...image, data: IMAGE_PLACEHOLDER } },
  } as Receipt | BatchReceipt;
  return { stripped, image };
}
