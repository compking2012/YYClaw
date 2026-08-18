import type { GatewayManager } from '../../gateway/manager';
import {
  extractTextFromOfficeMessage,
  parseGatewayChatEnvelope,
  payloadMatchesSession,
} from './run-completion';

function gatewayEventMatchesRun(runId: string | undefined, eventRunId: unknown): boolean {
  if (!runId) return true;
  if (eventRunId == null || eventRunId === '') return false;
  return String(eventRunId) === runId;
}

export function watchAgentSessionText(
  gateway: GatewayManager,
  targetSessionKey: string,
  runId: string | undefined,
  onText: (text: string) => void,
): () => void {
  const onGatewayChat = (data: { message?: unknown }) => {
    const parsed = parseGatewayChatEnvelope(data);
    if (!parsed.sessionKey || parsed.sessionKey !== targetSessionKey) return;
    if (!gatewayEventMatchesRun(runId, parsed.runId)) return;
    const inner = parsed.message;
    if (!inner || inner.role !== 'assistant') return;
    const text = extractTextFromOfficeMessage(inner);
    if (!text) return;
    const state = parsed.state ?? '';
    if (state === 'delta' || state === 'started' || state === 'final' || !state) {
      onText(text);
    }
  };
  const onGatewayNotification = (data: { method?: string; params?: unknown }) => {
    const method = data?.method ?? '';
    if (method !== 'agent' && method !== 'chat') return;
    if (!payloadMatchesSession(data.params, targetSessionKey)) return;
    if (runId) {
      const p = (data.params && typeof data.params === 'object' ? data.params : {}) as Record<
        string,
        unknown
      >;
      const dataObj =
        p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
      const eventRunId = p.runId ?? dataObj.runId;
      if (!gatewayEventMatchesRun(runId, eventRunId)) return;
    }
    onGatewayChat({ message: data.params });
  };
  gateway.on('chat:message', onGatewayChat);
  gateway.on('notification', onGatewayNotification);
  return () => {
    gateway.off('chat:message', onGatewayChat);
    gateway.off('notification', onGatewayNotification);
  };
}
