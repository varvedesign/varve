import type { WorkerTensor } from './inferenceWorker';

export interface NativeTensorContext {
  requestId: string;
  sessionId: string;
  modelId: string;
  executionProvider?: string;
}

interface Descriptor {
  name: string;
  dtype: 'float32' | 'int64' | 'bool';
  dims: number[];
}

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;

function byteLength(descriptor: Descriptor): number {
  if (
    !descriptor.name ||
    descriptor.name.length > 256 ||
    !Array.isArray(descriptor.dims) ||
    descriptor.dims.length > 8
  ) {
    throw new Error('Invalid native tensor name or rank');
  }
  if (descriptor.dtype !== 'float32' && descriptor.dtype !== 'int64' && descriptor.dtype !== 'bool')
    throw new Error('Unsupported native tensor type');
  let count = 1;
  for (const dimension of descriptor.dims) {
    if (!Number.isSafeInteger(dimension) || dimension < 0 || dimension > 1_000_000)
      throw new Error('Invalid native tensor dimension');
    count *= dimension;
    if (!Number.isSafeInteger(count)) throw new Error('Native tensor shape overflow');
  }
  const bytes = count * (descriptor.dtype === 'int64' ? 8 : descriptor.dtype === 'bool' ? 1 : 4);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES)
    throw new Error('Native tensor exceeds the byte limit');
  return bytes;
}

export function encodeNativeTensors(
  context: NativeTensorContext,
  tensors: Record<string, WorkerTensor>,
): Uint8Array {
  const descriptors = Object.entries(tensors).map(
    ([name, tensor]): Descriptor => ({ name, dtype: tensor.dtype ?? 'float32', dims: tensor.dims }),
  );
  if (!descriptors.length || descriptors.length > 128)
    throw new Error('Invalid native tensor count');
  let total = 0;
  for (const descriptor of descriptors) {
    const data = tensors[descriptor.name]!.data;
    const bytes = byteLength(descriptor);
    if (
      bytes !== data.byteLength ||
      (descriptor.dtype === 'int64'
        ? !(data instanceof BigInt64Array)
        : descriptor.dtype === 'bool'
          ? !(data instanceof Uint8Array)
          : !(data instanceof Float32Array))
    )
      throw new Error('Native tensor shape or type does not match its data');
    total += bytes;
  }
  if (total > MAX_BYTES) throw new Error('Native tensor packet exceeds the byte limit');
  const header = new TextEncoder().encode(JSON.stringify({ context, tensors: descriptors }));
  if (header.length > MAX_HEADER_BYTES) throw new Error('Native tensor header is too large');
  const buffer = new ArrayBuffer(8 + header.length + total);
  const bytes = new Uint8Array(buffer);
  bytes.set([86, 78, 84, 49]);
  const view = new DataView(buffer);
  view.setUint32(4, header.length, true);
  bytes.set(header, 8);
  let offset = 8 + header.length;
  for (const descriptor of descriptors) {
    const data = tensors[descriptor.name]!.data;
    for (const value of data) {
      if (typeof value === 'bigint') {
        view.setBigInt64(offset, value, true);
        offset += 8;
      } else if (descriptor.dtype === 'bool') {
        if (value !== 0 && value !== 1) throw new Error('Invalid native boolean value');
        view.setUint8(offset++, value);
      } else {
        if (!Number.isFinite(value)) throw new Error('Native tensor contains non-finite values');
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
  }
  return bytes;
}

export function decodeNativeTensors(input: ArrayBuffer | number[]): {
  context: NativeTensorContext;
  tensors: Record<string, WorkerTensor>;
} {
  const buffer = Array.isArray(input) ? Uint8Array.from(input).buffer : input;
  if (buffer.byteLength < 8 || buffer.byteLength > MAX_BYTES + MAX_HEADER_BYTES + 8)
    throw new Error('Invalid native tensor packet');
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x564e5431)
    throw new Error('Invalid native tensor packet version');
  const length = view.getUint32(4, true);
  if (length > MAX_HEADER_BYTES || length > buffer.byteLength - 8)
    throw new Error('Invalid native tensor header length');
  const header = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 8, length)),
  ) as { context: NativeTensorContext; tensors: Descriptor[] };
  if (
    !header.context ||
    !Array.isArray(header.tensors) ||
    !header.tensors.length ||
    header.tensors.length > 128
  )
    throw new Error('Invalid native tensor header');
  const tensors: Record<string, WorkerTensor> = Object.create(null) as Record<string, WorkerTensor>;
  let offset = 8 + length;
  for (const descriptor of header.tensors) {
    const bytes = byteLength(descriptor);
    if (Object.hasOwn(tensors, descriptor.name) || offset + bytes > buffer.byteLength)
      throw new Error('Duplicate or truncated native tensor');
    const data =
      descriptor.dtype === 'int64'
        ? new BigInt64Array(bytes / 8)
        : descriptor.dtype === 'bool'
          ? new Uint8Array(bytes)
          : new Float32Array(bytes / 4);
    for (let i = 0; i < data.length; i++) {
      if (data instanceof BigInt64Array) {
        data[i] = view.getBigInt64(offset, true);
        offset += 8;
      } else if (data instanceof Uint8Array) {
        const value = view.getUint8(offset++);
        if (value !== 0 && value !== 1) throw new Error('Invalid native boolean value');
        data[i] = value;
      } else {
        const value = view.getFloat32(offset, true);
        if (!Number.isFinite(value)) throw new Error('Native output contains non-finite values');
        data[i] = value;
        offset += 4;
      }
    }
    tensors[descriptor.name] = { data, dims: descriptor.dims, dtype: descriptor.dtype };
  }
  if (offset !== buffer.byteLength) throw new Error('Trailing native tensor data');
  return { context: header.context, tensors };
}
