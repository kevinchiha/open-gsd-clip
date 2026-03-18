import { z } from 'zod';

/**
 * JSON-RPC 2.0 request schema.
 * Validates incoming messages conform to the JSON-RPC 2.0 specification.
 */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/**
 * JSON-RPC 2.0 success response.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result: unknown;
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 error response.
 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/**
 * Standard JSON-RPC 2.0 error codes.
 */
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Paperclip plugin manifest v1 interface.
 * Returned by the `initialize` RPC method.
 */
export interface PaperclipPluginManifestV1 {
  id: string;
  apiVersion: number;
  version: string;
  displayName: string;
  description: string;
  author: string;
  categories: string[];
  capabilities: string[];
  entrypoints: {
    worker: string;
  };
}
