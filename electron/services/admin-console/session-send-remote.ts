export type SessionSendRemoteRequest = {
  schema_version: 1;
  target_client_id: string;
  session_key: string;
  message: string;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
};

export type SessionListRemoteRequest = {
  schema_version: 1;
  target_client_id: string;
  agent_id?: string;
  include_derived_titles?: boolean;
  include_last_message?: boolean;
  metadata?: Record<string, unknown>;
};

export type SessionHistoryRemoteRequest = {
  schema_version: 1;
  target_client_id: string;
  session_key: string;
  limit?: number;
  metadata?: Record<string, unknown>;
};

export type SessionStatusRemoteRequest = {
  schema_version: 1;
  target_client_id: string;
  session_key: string;
  metadata?: Record<string, unknown>;
};

export type SharedWorkspaceSyncRequest = {
  schema_version: 1;
  run_id: number;
  agent_id: string;
  workspace_id?: string;
  mode?: 'pull' | 'push' | 'push_pull';
  metadata?: Record<string, unknown>;
};

export type SessionSendRemoteAck = {
  type: 'session_send_remote_ack';
  schema_version: 1;
  source_client_id: string;
  target_client_id: string;
  session_key: string;
  idempotency_key: string;
  target_result: unknown;
};

export type SessionListRemoteAck = {
  type: 'session_list_remote_ack';
  schema_version: 1;
  source_client_id: string;
  target_client_id: string;
  target_result: unknown;
};

export type SessionHistoryRemoteAck = {
  type: 'session_history_remote_ack';
  schema_version: 1;
  source_client_id: string;
  target_client_id: string;
  session_key: string;
  target_result: unknown;
};

export type SessionStatusRemoteAck = {
  type: 'session_status_remote_ack';
  schema_version: 1;
  source_client_id: string;
  target_client_id: string;
  session_key: string;
  target_result: unknown;
};

export type SharedWorkspaceSyncAck = {
  type: 'shared_workspace_sync_ack';
  schema_version: 1;
  source_client_id: string;
  run_id: number;
  workspace_id: string;
  agent_id: string;
  mode: 'pull' | 'push' | 'push_pull';
  project_root?: string;
  workspace_revision?: string;
  pushed_files?: number;
  pulled_files?: number;
  changed_files?: unknown[];
  metadata?: Record<string, unknown>;
};

export function formatRemoteSessionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return rec.message;
    }
    if (typeof rec.error === 'string' && rec.error.trim()) {
      return rec.error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function readRequiredString(rec: Record<string, unknown>, key: string, operation: string): string {
  const value = rec[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${operation} payload missing string "${key}"`);
  }
  return value;
}

function readOptionalString(rec: Record<string, unknown>, key: string, operation: string): string | undefined {
  const value = rec[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${operation} payload optional "${key}" must be a non-empty string`);
  }
  return value;
}

function readOptionalBoolean(rec: Record<string, unknown>, key: string, operation: string): boolean | undefined {
  const value = rec[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${operation} payload optional "${key}" must be a boolean`);
  }
  return value;
}

function readOptionalPositiveInteger(rec: Record<string, unknown>, key: string, operation: string): number | undefined {
  const value = rec[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${operation} payload optional "${key}" must be a positive integer`);
  }
  return value;
}

function readRequiredPositiveInteger(rec: Record<string, unknown>, key: string, operation: string): number {
  const value = rec[key];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new Error(`${operation} payload missing positive integer "${key}"`);
}

function readOptionalMetadata(rec: Record<string, unknown>, operation: string): Record<string, unknown> | undefined {
  const metadata = rec.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`${operation} payload optional "metadata" must be a JSON object`);
  }
  return metadata as Record<string, unknown>;
}

function readObject(input: unknown, operation: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${operation} payload must be a JSON object`);
  }
  return input as Record<string, unknown>;
}

export function normalizeSessionSendRemoteRequest(input: unknown): SessionSendRemoteRequest {
  const operation = 'session_send_remote';
  const rec = readObject(input, operation);
  const targetClientId = readRequiredString(rec, 'target_client_id', operation);
  const sessionKey = readRequiredString(rec, 'session_key', operation);
  const message = readRequiredString(rec, 'message', operation);
  const idempotencyKey = rec.idempotency_key;
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) {
    throw new Error('session_send_remote payload optional "idempotency_key" must be a non-empty string');
  }
  const metadata = readOptionalMetadata(rec, operation);

  return {
    schema_version: 1,
    target_client_id: targetClientId,
    session_key: sessionKey,
    message,
    ...(typeof idempotencyKey === 'string' ? { idempotency_key: idempotencyKey } : {}),
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { metadata: metadata as Record<string, unknown> }
      : {}),
  };
}

export function normalizeSessionListRemoteRequest(input: unknown): SessionListRemoteRequest {
  const operation = 'session_list_remote';
  const rec = readObject(input, operation);
  const agentId = readOptionalString(rec, 'agent_id', operation);
  const includeDerivedTitles = readOptionalBoolean(rec, 'include_derived_titles', operation);
  const includeLastMessage = readOptionalBoolean(rec, 'include_last_message', operation);
  const metadata = readOptionalMetadata(rec, operation);

  return {
    schema_version: 1,
    target_client_id: readRequiredString(rec, 'target_client_id', operation),
    ...(agentId ? { agent_id: agentId } : {}),
    ...(includeDerivedTitles !== undefined ? { include_derived_titles: includeDerivedTitles } : {}),
    ...(includeLastMessage !== undefined ? { include_last_message: includeLastMessage } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeSessionHistoryRemoteRequest(input: unknown): SessionHistoryRemoteRequest {
  const operation = 'session_history_remote';
  const rec = readObject(input, operation);
  const limit = readOptionalPositiveInteger(rec, 'limit', operation);
  const metadata = readOptionalMetadata(rec, operation);

  return {
    schema_version: 1,
    target_client_id: readRequiredString(rec, 'target_client_id', operation),
    session_key: readRequiredString(rec, 'session_key', operation),
    ...(limit !== undefined ? { limit } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeSessionStatusRemoteRequest(input: unknown): SessionStatusRemoteRequest {
  const operation = 'session_status_remote';
  const rec = readObject(input, operation);
  const metadata = readOptionalMetadata(rec, operation);

  return {
    schema_version: 1,
    target_client_id: readRequiredString(rec, 'target_client_id', operation),
    session_key: readRequiredString(rec, 'session_key', operation),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeSharedWorkspaceSyncRequest(input: unknown): SharedWorkspaceSyncRequest {
  const operation = 'shared_workspace_sync';
  const rec = readObject(input, operation);
  const workspaceId = readOptionalString(rec, 'workspace_id', operation);
  const metadata = readOptionalMetadata(rec, operation);
  const rawMode = rec.mode;
  let mode: SharedWorkspaceSyncRequest['mode'];
  if (rawMode !== undefined) {
    if (rawMode !== 'pull' && rawMode !== 'push' && rawMode !== 'push_pull') {
      throw new Error(`${operation} payload optional "mode" must be one of pull, push, push_pull`);
    }
    mode = rawMode;
  }

  return {
    schema_version: 1,
    run_id: readRequiredPositiveInteger(rec, 'run_id', operation),
    agent_id: readRequiredString(rec, 'agent_id', operation),
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(mode ? { mode } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
