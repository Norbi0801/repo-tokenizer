import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ServerMcpConfig } from '../config';

export interface McpSessionClaims {
  sessionId: string;
  roles: Set<string>;
  tokenLabel?: string;
}

export interface McpInvocationContext extends McpSessionClaims {
  sendEvent: (event: string, payload: unknown) => void;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  roles: string[];
  handler: (params: unknown, context: McpInvocationContext) => Promise<unknown>;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  roles: string[];
}

export interface McpTransport {
  path: string;
  shouldHandleUpgrade(request: IncomingMessage): boolean;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  broadcastEvent(event: string, payload: unknown): void;
}

export interface McpServerOptions {
  config?: ServerMcpConfig;
}
