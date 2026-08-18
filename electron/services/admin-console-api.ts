import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { adminConsoleClient } from './admin-console/centrifuge-client';
import {
  normalizeSessionHistoryRemoteRequest,
  normalizeSessionListRemoteRequest,
  normalizeSessionSendRemoteRequest,
  normalizeSessionStatusRemoteRequest,
  normalizeSharedWorkspaceSyncRequest,
} from './admin-console/session-send-remote';

export function createAdminConsoleApi(): CompleteHostServiceRegistry['adminConsole'] {
  return {
    sessionSendRemote: (payload) => adminConsoleClient.sessionSendRemote(
      normalizeSessionSendRemoteRequest(payload),
    ),
    sessionListRemote: (payload) => adminConsoleClient.sessionListRemote(
      normalizeSessionListRemoteRequest(payload),
    ),
    sessionHistoryRemote: (payload) => adminConsoleClient.sessionHistoryRemote(
      normalizeSessionHistoryRemoteRequest(payload),
    ),
    sessionStatusRemote: (payload) => adminConsoleClient.sessionStatusRemote(
      normalizeSessionStatusRemoteRequest(payload),
    ),
    sharedWorkspaceSync: (payload) => adminConsoleClient.sharedWorkspaceSync(
      normalizeSharedWorkspaceSyncRequest(payload),
    ),
  };
}
