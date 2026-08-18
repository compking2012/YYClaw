import type { BrowserWindow } from 'electron';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import { HostEventBus } from '../api/event-bus';
import { handleAgentRoutes } from '../api/routes/agents';
import { handleChannelRoutes } from '../api/routes/channels';
import { handleSettingsRoutes } from '../api/routes/settings';
import { handleSkillRoutes } from '../api/routes/skills';
import { handleOfficeRoutes } from '../api/routes/office';
import { getWorkflowEngine } from '../workflow';
import type { HostApiContext } from '../api/context';
import type { LegacyFetchPayload, LegacyFetchResult } from '@shared/host-api/contract';

class LegacyRequest extends EventEmitter implements AsyncIterable<Buffer> {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  private readonly body: Buffer;

  constructor(input: LegacyFetchPayload) {
    super();
    this.method = (input.method || 'GET').toUpperCase();
    this.url = input.path;
    this.headers = input.headers ?? {};
    this.body = Buffer.from(input.body ?? '', 'utf-8');
    if (this.body.length > 0 && !this.headers['content-length']) {
      this.headers['content-length'] = String(this.body.length);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
    if (this.body.length > 0) {
      yield this.body;
    }
  }
}

class LegacyResponse extends EventEmitter {
  statusCode = 200;
  private readonly headers = new Map<string, string>();
  private chunks: Buffer[] = [];

  setHeader(name: string, value: number | string | readonly string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.emit('finish');
    return this;
  }

  write(chunk: unknown): boolean {
    if (Buffer.isBuffer(chunk)) {
      this.chunks.push(chunk);
      return true;
    }
    if (typeof chunk === 'string') {
      this.chunks.push(Buffer.from(chunk, 'utf-8'));
      return true;
    }
    if (chunk !== undefined && chunk !== null) {
      this.chunks.push(Buffer.from(String(chunk), 'utf-8'));
    }
    return true;
  }

  toResult(): LegacyFetchResult {
    const raw = Buffer.concat(this.chunks).toString('utf-8');
    const contentType = this.headers.get('content-type') ?? '';
    const body = raw && contentType.includes('application/json')
      ? JSON.parse(raw)
      : raw || undefined;
    return {
      status: this.statusCode,
      headers: Object.fromEntries(this.headers),
      ...(body === undefined ? {} : { body }),
    };
  }
}

type LegacyApiContext = {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  mainWindow: BrowserWindow;
};

export function createLegacyApi(ctx: LegacyApiContext): CompleteHostServiceRegistry['legacy'] {
  const eventBus = new HostEventBus();
  const hostContext: HostApiContext = {
    gatewayManager: ctx.gatewayManager,
    clawHubService: ctx.clawHubService,
    eventBus,
    mainWindow: ctx.mainWindow,
    workflowEngine: getWorkflowEngine(ctx.gatewayManager),
  };

  const handlers = [
    handleAgentRoutes,
    handleChannelRoutes,
    handleSettingsRoutes,
    handleSkillRoutes,
    handleOfficeRoutes,
  ];

  return {
    fetch: async (payload) => {
      if (!payload || typeof payload.path !== 'string') {
        throw new Error('Invalid legacy fetch payload');
      }
      const url = new URL(payload.path, 'http://127.0.0.1');
      const req = new LegacyRequest(payload) as unknown as IncomingMessage;
      const res = new LegacyResponse() as unknown as ServerResponse & LegacyResponse;

      for (const handler of handlers) {
        const handled = await handler(req, res, url, hostContext);
        if (handled) {
          return res.toResult();
        }
      }

      return {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: { success: false, error: `Unsupported legacy API path: ${payload.method ?? 'GET'} ${payload.path}` },
      };
    },
  };
}
