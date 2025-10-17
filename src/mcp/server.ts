import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { getLogger } from '../common/logger';
import { McpToolAdapter } from './adapter';
import { McpInvocationContext, McpServerOptions, McpSessionClaims, McpTransport } from './types';
import pkg from '../../package.json';

interface TokenEntry {
  label: string;
  value: string;
  roles: string[];
}

interface McpSession {
  id: string;
  socket: WebSocket;
  claims: McpSessionClaims;
}

interface InvocationResolution {
  type: 'tools.list' | 'tool.invoke';
  name?: string;
  params?: unknown;
}

const JSON_RPC_VERSION = '2.0';

function normalizePath(value?: string): string {
  if (!value) {
    return '/mcp';
  }
  let normalized = value.startsWith('/') ? value : `/${value}`;
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export class McpServer implements McpTransport {
  private readonly log = getLogger('mcp:server');
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sessions = new Map<string, McpSession>();
  private readonly tokenIndex: TokenEntry[];
  private readonly allowAnonymous: boolean;
  private readonly defaultRoles: Set<string>;
  readonly path: string;

  constructor(
    private readonly adapter: McpToolAdapter,
    private readonly options: McpServerOptions = {},
  ) {
    this.path = normalizePath(options.config?.path);
    this.allowAnonymous = options.config?.allowAnonymous ?? false;
    this.defaultRoles = new Set(options.config?.defaultRoles ?? ['reader']);
    this.tokenIndex = this.buildTokenIndex(options.config?.tokens);
  }

  shouldHandleUpgrade(request: IncomingMessage): boolean {
    const url = this.parseUrl(request);
    if (!url) {
      return false;
    }
    const pathname = normalizePath(url.pathname);
    return pathname === this.path;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.shouldHandleUpgrade(request)) {
      socket.destroy();
      return;
    }
    const auth = this.authenticate(request);
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.setupSession(ws, request, auth);
    });
  }

  broadcastEvent(event: string, payload: unknown): void {
    for (const session of this.sessions.values()) {
      this.sendNotification(session, 'event', { name: event, payload });
    }
  }

  private buildTokenIndex(tokens?: McpServerOptions['config']['tokens']): TokenEntry[] {
    if (!tokens || tokens.length === 0) {
      return [];
    }
    const entries: TokenEntry[] = [];
    tokens.forEach((tokenConfig, index) => {
      const value = process.env[tokenConfig.tokenEnv];
      if (!value) {
        this.log.warn(`Token env "${tokenConfig.tokenEnv}" not set; skipping MCP token entry.`);
        return;
      }
      entries.push({
        label: tokenConfig.description ?? tokenConfig.tokenEnv ?? `token-${index}`,
        value,
        roles: tokenConfig.roles && tokenConfig.roles.length > 0 ? tokenConfig.roles : ['maintainer'],
      });
    });
    return entries;
  }

  private setupSession(socket: WebSocket, request: IncomingMessage, auth: { roles: Set<string>; tokenLabel?: string }) {
    const sessionId = randomUUID();
    const claims: McpSessionClaims = {
      sessionId,
      roles: auth.roles,
      tokenLabel: auth.tokenLabel,
    };
    const session: McpSession = { id: sessionId, socket, claims };
    this.sessions.set(sessionId, session);
    this.log.info('MCP session established', {
      sessionId,
      roles: Array.from(claims.roles),
      path: this.path,
      token: auth.tokenLabel ?? 'anonymous',
      remote: request.socket.remoteAddress,
    });
    socket.on('message', (data) => {
      void this.handleMessage(session, data);
    });
    socket.on('close', (code, reason) => {
      this.sessions.delete(sessionId);
      const reasonText = reason.toString('utf8');
      this.log.info('MCP session closed', { sessionId, code, reason: reasonText });
    });
    socket.on('error', (error) => {
      this.log.warn(`WebSocket error for session ${sessionId}: ${(error as Error).message}`);
    });
    this.sendWelcome(session);
  }

  private async handleMessage(session: McpSession, raw: WebSocket.RawData): Promise<void> {
    const payload = typeof raw === 'string' ? raw : raw.toString('utf8');
    let message: any;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      this.sendError(session, null, -32700, 'Invalid JSON payload');
      return;
    }

    if (Array.isArray(message)) {
      for (const entry of message) {
        await this.processMessage(session, entry);
      }
      return;
    }

    await this.processMessage(session, message);
  }

  private async processMessage(session: McpSession, message: any): Promise<void> {
    if (!message || typeof message !== 'object') {
      this.sendError(session, null, -32600, 'Invalid request');
      return;
    }
    const { id, method } = message;
    if (!method || typeof method !== 'string') {
      this.sendError(session, id ?? null, -32600, 'Invalid request method');
      return;
    }
    if (method === 'ping') {
      if (id !== undefined && id !== null) {
        this.sendResponse(session, id, { message: 'pong' });
      } else {
        this.sendNotification(session, 'event', { name: 'pong', payload: {} });
      }
      return;
    }

    const resolution = this.resolveInvocation(method, message.params);
    if (!resolution) {
      this.sendError(session, id ?? null, -32601, `Unsupported method "${method}"`);
      return;
    }
    if (resolution.type === 'tools.list') {
      if (id === undefined || id === null) {
        return;
      }
      const tools = this.adapter.listTools();
      this.sendResponse(session, id, { tools });
      return;
    }

    const toolName = resolution.name;
    if (!toolName) {
      this.sendError(session, id ?? null, -32602, 'Tool name missing for invocation');
      return;
    }
    const tool = this.adapter.getTool(toolName);
    if (!tool) {
      this.sendError(session, id ?? null, -32601, `Tool "${toolName}" not found`);
      return;
    }
    if (!this.isRoleAllowed(session.claims.roles, tool.roles)) {
      this.sendError(session, id ?? null, 403, `Forbidden: missing role for tool "${toolName}"`);
      return;
    }

    const context: McpInvocationContext = {
      ...session.claims,
      sendEvent: (event, payload) => {
        this.sendNotification(session, 'event', { name: event, payload });
      },
    };

    try {
      const result = await tool.handler(resolution.params, context);
      if (id !== undefined && id !== null) {
        this.sendResponse(session, id, result ?? {});
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.log.error(`Tool invocation failed (${toolName}): ${messageText}`);
      this.sendError(session, id ?? null, -32000, messageText);
    }
  }

  private resolveInvocation(method: string, params: unknown): InvocationResolution | undefined {
    switch (method) {
      case 'tools.list':
      case 'tools/list':
      case 'list_tools':
        return { type: 'tools.list' };
      case 'tools.invoke':
      case 'tools/invoke': {
        if (!params || typeof params !== 'object') {
          return undefined;
        }
        const name = (params as Record<string, unknown>).name ?? (params as Record<string, unknown>).tool;
        const args = (params as Record<string, unknown>).arguments ??
          (params as Record<string, unknown>).args ??
          (params as Record<string, unknown>).params ??
          {};
        if (!name || typeof name !== 'string') {
          return undefined;
        }
        return { type: 'tool.invoke', name, params: args };
      }
      default: {
        const name = this.normalizeToolName(method);
        if (!name) {
          return undefined;
        }
        return { type: 'tool.invoke', name, params };
      }
    }
  }

  private normalizeToolName(method: string): string | undefined {
    if (!method) {
      return undefined;
    }
    let name = method;
    if (name.startsWith('tool.')) {
      name = name.slice('tool.'.length);
    } else if (name.startsWith('tool/')) {
      name = name.slice('tool/'.length);
    }
    if (!name) {
      return undefined;
    }
    if (name === 'tools.list' || name === 'tools/list') {
      return undefined;
    }
    return name;
  }

  private isRoleAllowed(sessionRoles: Set<string>, toolRoles: string[]): boolean {
    if (!toolRoles || toolRoles.length === 0) {
      return true;
    }
    if (sessionRoles.size === 0) {
      return false;
    }
    return toolRoles.some((role) => sessionRoles.has(role));
  }

  private sendWelcome(session: McpSession) {
    this.sendNotification(session, 'session.welcome', {
      sessionId: session.id,
      server: {
        name: 'repo-tokenizer',
        version: pkg.version,
      },
      roles: Array.from(session.claims.roles),
      token: session.claims.tokenLabel ?? (this.allowAnonymous ? 'anonymous' : undefined),
    });
    this.sendNotification(session, 'tools.available', {
      tools: this.adapter.listTools(),
    });
  }

  private sendResponse(session: McpSession, id: unknown, result: unknown) {
    this.safeSend(session, {
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    });
  }

  private sendError(session: McpSession, id: unknown, code: number, message: string) {
    this.safeSend(session, {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: {
        code,
        message,
      },
    });
  }

  private sendNotification(session: McpSession, method: string, params?: unknown) {
    this.safeSend(session, {
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    });
  }

  private safeSend(session: McpSession, payload: unknown) {
    if (session.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      session.socket.send(JSON.stringify(payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Failed to send MCP message to ${session.id}: ${message}`);
    }
  }

  private parseUrl(request: IncomingMessage): URL | undefined {
    if (!request.url) {
      return undefined;
    }
    try {
      return new URL(request.url, 'http://localhost');
    } catch {
      return undefined;
    }
  }

  private authenticate(request: IncomingMessage): { roles: Set<string>; tokenLabel?: string } | undefined {
    const token = this.extractToken(request);
    if (!token) {
      if (this.allowAnonymous) {
        return {
          roles: new Set(this.defaultRoles),
          tokenLabel: 'anonymous',
        };
      }
      return undefined;
    }
    const entry = this.tokenIndex.find((candidate) => candidate.value === token);
    if (!entry) {
      return undefined;
    }
    const roles = new Set(this.defaultRoles);
    entry.roles.forEach((role) => roles.add(role));
    return {
      roles,
      tokenLabel: entry.label,
    };
  }

  private extractToken(request: IncomingMessage): string | undefined {
    const header = request.headers['authorization'];
    if (header) {
      const value = Array.isArray(header) ? header[header.length - 1] : header;
      if (value && value.startsWith('Bearer ')) {
        return value.slice('Bearer '.length).trim();
      }
    }
    const url = this.parseUrl(request);
    const fromQuery = url?.searchParams.get('token');
    if (fromQuery) {
      return fromQuery;
    }
    return undefined;
  }
}
