const SessionSendRemoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['target_client_id', 'session_key', 'message'],
  properties: {
    target_client_id: {
      type: 'string',
      minLength: 1,
      description: 'Stable Manager/Centrifuge client id for the target client.',
    },
    session_key: {
      type: 'string',
      minLength: 1,
      description: 'Target OpenClaw session key, for example agent:default:some-session.',
    },
    message: {
      type: 'string',
      minLength: 1,
      description: 'Message text to deliver to the target session.',
    },
    idempotency_key: {
      type: 'string',
      minLength: 1,
      description: 'Optional source-generated idempotency key.',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional metadata such as source_agent_id or source_session_key.',
    },
  },
};

const SessionListRemoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['target_client_id'],
  properties: {
    target_client_id: {
      type: 'string',
      minLength: 1,
      description: 'Stable Manager/Centrifuge client id for the target client.',
    },
    agent_id: {
      type: 'string',
      minLength: 1,
      description: 'Optional target agent id to filter sessions.',
    },
    include_derived_titles: {
      type: 'boolean',
      description: 'Whether the target should derive display titles when supported.',
    },
    include_last_message: {
      type: 'boolean',
      description: 'Whether the target should include last-message metadata when supported.',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional caller metadata forwarded to Manager.',
    },
  },
};

const SessionHistoryRemoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['target_client_id', 'session_key'],
  properties: {
    target_client_id: {
      type: 'string',
      minLength: 1,
      description: 'Stable Manager/Centrifuge client id for the target client.',
    },
    session_key: {
      type: 'string',
      minLength: 1,
      description: 'Target OpenClaw session key, for example agent:default:some-session.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      description: 'Optional maximum number of messages to return.',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional caller metadata forwarded to Manager.',
    },
  },
};

const SessionStatusRemoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['target_client_id', 'session_key'],
  properties: {
    target_client_id: {
      type: 'string',
      minLength: 1,
      description: 'Stable Manager/Centrifuge client id for the target client.',
    },
    session_key: {
      type: 'string',
      minLength: 1,
      description: 'Target OpenClaw session key, for example agent:default:some-session.',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional caller metadata forwarded to Manager.',
    },
  },
};

const SharedWorkspaceSyncSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'agent_id'],
  properties: {
    run_id: {
      oneOf: [
        { type: 'integer', minimum: 1 },
        { type: 'string', minLength: 1 },
      ],
      description: 'Admin Console Office task run id.',
    },
    agent_id: {
      type: 'string',
      minLength: 1,
      description: 'Current Office agent id for this session.',
    },
    workspace_id: {
      type: 'string',
      minLength: 1,
      description: 'Optional Admin shared workspace id. If omitted, Manager uses the run workspace.',
    },
    mode: {
      type: 'string',
      enum: ['pull', 'push', 'push_pull'],
      description: 'pull downloads Manager canonical files to this client mirror; push uploads local changes; push_pull does both.',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional Office collaboration metadata forwarded to Manager.',
    },
  },
};

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function readHostApiConfig() {
  const baseUrl = (process.env.CLAWX_HOST_API_URL || '').replace(/\/+$/, '');
  const token = process.env.CLAWX_HOST_API_TOKEN || '';
  if (!baseUrl || !token) {
    throw new Error('YYClaw Host API is not configured for remote session tools');
  }
  return { baseUrl, token };
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    if (typeof error.error === 'string' && error.error.trim()) return error.error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

async function postRemoteSessionTool(route, params) {
  const { baseUrl, token } = readHostApiConfig();
  const response = await fetch(`${baseUrl}/api/admin-console/${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { success: false, error: text || `HTTP ${response.status}` };
  }

  if (!response.ok && payload && typeof payload === 'object' && !payload.error) {
    payload.error = `HTTP ${response.status}`;
  }
  return payload;
}

async function executeRemoteSessionTool(route, params) {
  try {
    return toolResult(await postRemoteSessionTool(route, params || {}));
  } catch (error) {
    return toolResult({
      success: false,
      error: formatError(error),
    });
  }
}

function registerRemoteSessionTool(api, options) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters,
    async execute(_toolCallId, params) {
      return executeRemoteSessionTool(options.route, params);
    },
  });
}

export default {
  id: 'session-send-remote',
  name: 'Remote Session Tools',
  description: 'Inspect or send OpenClaw sessions on another client through the connected Manager, and sync Admin shared workspaces.',
  register(api) {
    registerRemoteSessionTool(api, {
      name: 'session_send_remote',
      label: 'Session Send Remote',
      description: 'Send a message into a session on another online client connected to the same Manager. Returns the Manager delivery acknowledgement or error.',
      parameters: SessionSendRemoteSchema,
      route: 'session-send-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'sessions_send_remote',
      label: 'Sessions Send Remote',
      description: 'Compatibility alias for session_send_remote.',
      parameters: SessionSendRemoteSchema,
      route: 'session-send-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'session_list_remote',
      label: 'Session List Remote',
      description: 'List sessions from another online client connected to the same Manager.',
      parameters: SessionListRemoteSchema,
      route: 'session-list-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'sessions_list_remote',
      label: 'Sessions List Remote',
      description: 'Compatibility alias for session_list_remote.',
      parameters: SessionListRemoteSchema,
      route: 'session-list-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'session_history_remote',
      label: 'Session History Remote',
      description: 'Load chat history for a session on another online client connected to the same Manager.',
      parameters: SessionHistoryRemoteSchema,
      route: 'session-history-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'sessions_history_remote',
      label: 'Sessions History Remote',
      description: 'Compatibility alias for session_history_remote.',
      parameters: SessionHistoryRemoteSchema,
      route: 'session-history-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'session_status_remote',
      label: 'Session Status Remote',
      description: 'Get the best available status for a session on another online client connected to the same Manager.',
      parameters: SessionStatusRemoteSchema,
      route: 'session-status-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'sessions_status_remote',
      label: 'Sessions Status Remote',
      description: 'Compatibility alias for session_status_remote.',
      parameters: SessionStatusRemoteSchema,
      route: 'session-status-remote',
    });
    registerRemoteSessionTool(api, {
      name: 'shared_workspace_sync',
      label: 'Shared Workspace Sync',
      description: 'Queue synchronization of the current Admin Console shared workspace between Manager canonical storage and this client mirror. Use pull before reading peer artifacts; use push_pull after writing files that peers should see. If the result status is queued, wait a few seconds before reading files.',
      parameters: SharedWorkspaceSyncSchema,
      route: 'shared-workspace-sync',
    });
    registerRemoteSessionTool(api, {
      name: 'office_shared_workspace_sync',
      label: 'Office Shared Workspace Sync',
      description: 'Compatibility alias for shared_workspace_sync.',
      parameters: SharedWorkspaceSyncSchema,
      route: 'shared-workspace-sync',
    });
  },
};
