/**
 * JSON-RPC 2.0 message handling for the control protocol.
 *
 * Application outcomes are never JSON-RPC errors: a command the executor
 * refused is a successful RPC whose result is a receipt with
 * `outcome: "rejected"`. JSON-RPC errors are reserved for protocol problems
 * (unparseable frame, unknown method, not authenticated), so a client can tell
 * "the transport worked and the editor said no" from "the transport failed".
 */
import { type JsonParseOptions, parseStrictJson } from '../json';

export const JSONRPC_VERSION = '2.0';

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Application range (-32000..-32099), defined by varve.control/1.
  UNAUTHENTICATED: -32001,
  SESSION_REQUIRED: -32002,
  FRAME_TOO_LARGE: -32003,
  PROTOCOL_UNSUPPORTED: -32004,
  RESPONSE_TOO_LARGE: -32005,
} as const;

export type RpcId = string | number;

export interface RpcRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export type FrameParse =
  | { kind: 'request'; request: RpcRequest }
  /** Valid notification (no id): never answered, never executed for mutations. */
  | { kind: 'notification'; method: string }
  | { kind: 'error'; response: string };

export function encodeResult(id: RpcId | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, result });
}

export function encodeError(
  id: RpcId | null,
  code: number,
  message: string,
  data?: unknown,
): string {
  return JSON.stringify({
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

export function parseFrame(line: string, options: JsonParseOptions = {}): FrameParse {
  const parsed = parseStrictJson(line, options);
  if (!parsed.ok) {
    return {
      kind: 'error',
      response: encodeError(null, RPC_ERROR.PARSE_ERROR, `invalid JSON: ${parsed.error.message}`, {
        code: parsed.error.code,
        offset: parsed.error.offset,
      }),
    };
  }
  const value = parsed.value;
  if (Array.isArray(value)) {
    return {
      kind: 'error',
      response: encodeError(
        null,
        RPC_ERROR.INVALID_REQUEST,
        'JSON-RPC batch arrays are not supported; send one request per line, or use the batch.execute method for an ordered editing transaction',
      ),
    };
  }
  if (typeof value !== 'object' || value === null) {
    return {
      kind: 'error',
      response: encodeError(null, RPC_ERROR.INVALID_REQUEST, 'a request must be a JSON object'),
    };
  }
  const message = value as Record<string, unknown>;
  const id = message.id;
  const idOk = typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
  if (message.jsonrpc !== JSONRPC_VERSION) {
    return {
      kind: 'error',
      response: encodeError(
        idOk ? (id as RpcId) : null,
        RPC_ERROR.INVALID_REQUEST,
        'jsonrpc must be "2.0"',
      ),
    };
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    return {
      kind: 'error',
      response: encodeError(
        idOk ? (id as RpcId) : null,
        RPC_ERROR.INVALID_REQUEST,
        'method must be a non-empty string',
      ),
    };
  }
  if (!('id' in message)) return { kind: 'notification', method: message.method };
  if (!idOk) {
    return {
      kind: 'error',
      response: encodeError(
        null,
        RPC_ERROR.INVALID_REQUEST,
        'id must be a string or a finite number (null is not accepted)',
      ),
    };
  }
  return {
    kind: 'request',
    request: { id: id as RpcId, method: message.method, params: message.params ?? {} },
  };
}
