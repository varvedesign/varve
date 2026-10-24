import { describe, expect, it } from 'vitest';
import { decodeNativeTensors, encodeNativeTensors } from './nativeTensorWire';

const context = { requestId: 'request', sessionId: 'session', modelId: 'model' };

describe('native binary tensor transport', () => {
  it('preserves int64 extremes, scalars, and fractional float32 without JSON rounding', () => {
    const tensors = {
      tokens: {
        dtype: 'int64' as const,
        data: BigInt64Array.of(-(2n ** 63n), 2n ** 63n - 1n),
        dims: [1, 2],
      },
      score: { dtype: 'float32' as const, data: Float32Array.of(-0.0), dims: [] },
      features: { data: Float32Array.of(0.125, -0.5), dims: [2] },
    };
    const packet = encodeNativeTensors(context, tensors);
    const decoded = decodeNativeTensors(packet.buffer as ArrayBuffer);
    expect(decoded.context).toEqual(context);
    expect(decoded.tensors.tokens).toEqual(tensors.tokens);
    expect(Object.is(decoded.tensors.score?.data[0], -0)).toBe(true);
    expect(decoded.tensors.features?.data).toEqual(tensors.features.data);
  });

  it('rejects shape/type mismatch and non-finite input before sending native IPC', () => {
    expect(() =>
      encodeNativeTensors(context, { x: { dims: [2], data: Float32Array.of(1) } }),
    ).toThrow(/shape/);
    expect(() =>
      encodeNativeTensors(context, { x: { dims: [1], data: Float32Array.of(1), dtype: 'int64' } }),
    ).toThrow(/type/);
    expect(() =>
      encodeNativeTensors(context, { x: { dims: [1], data: Float32Array.of(Number.NaN) } }),
    ).toThrow(/non-finite/);
  });

  it('rejects truncated, trailing and oversized packets without output allocation', () => {
    const packet = encodeNativeTensors(context, { x: { dims: [1], data: Float32Array.of(1) } });
    expect(() => decodeNativeTensors(packet.slice(0, -1).buffer)).toThrow(/truncated/);
    expect(() => decodeNativeTensors([...packet, 0])).toThrow(/Trailing/);
    const badHeader = packet.slice();
    new DataView(badHeader.buffer).setUint32(4, 0xffffffff, true);
    expect(() => decodeNativeTensors(badHeader.buffer)).toThrow(/header length/);
  });

  it('round-trips the boolean cache flag required by the shipped TrOCR decoder', () => {
    const header = new TextEncoder().encode(
      JSON.stringify({
        context,
        tensors: [{ name: 'use_cache_branch', dtype: 'bool', dims: [2] }],
      }),
    );
    const packet = new Uint8Array(8 + header.length + 2);
    packet.set([86, 78, 84, 49]);
    new DataView(packet.buffer).setUint32(4, header.length, true);
    packet.set(header, 8);
    packet.set([0, 1], 8 + header.length);
    const decoded = decodeNativeTensors(packet.buffer);
    expect(decoded.tensors.use_cache_branch).toEqual({
      data: Uint8Array.of(0, 1),
      dims: [2],
      dtype: 'bool',
    });
    expect(encodeNativeTensors(context, decoded.tensors)).toEqual(packet);
    packet[packet.length - 1] = 2;
    expect(() => decodeNativeTensors(packet.buffer)).toThrow(/boolean/);
  });
});
