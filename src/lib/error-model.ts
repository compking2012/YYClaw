export type AppErrorCode =
  | 'AUTH_INVALID'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'QUOTA'
  | 'UPSTREAM'
  | 'PERMISSION'
  | 'CHANNEL_UNAVAILABLE'
  | 'NETWORK'
  | 'CONFIG'
  | 'WORKSPACE'
  | 'PROCESS_FAILED'
  | 'GATEWAY'
  | 'UNKNOWN';

export class AppError extends Error {
  code: AppErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, cause?: unknown, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}

/**
 * Map a backend / openclaw error code string to an AppErrorCode.
 * Handles both the host IPC code set (VALIDATION/PERMISSION/...) and the
 * snake_case codes upstream model providers emit (rate_limit_error, ...).
 */
export function mapBackendErrorCode(code?: string): AppErrorCode {
  if (!code) return 'UNKNOWN';

  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'PERMISSION':
      return 'PERMISSION';
    case 'GATEWAY':
      return 'GATEWAY';
    case 'VALIDATION':
      return 'CONFIG';
    case 'UNSUPPORTED':
      return 'CHANNEL_UNAVAILABLE';
    default:
      break;
  }

  switch (code.toLowerCase()) {
    case 'authentication_error':
      return 'AUTH_INVALID';
    case 'permission_error':
      return 'PERMISSION';
    case 'rate_limit_error':
    case 'rate_limited':
      return 'RATE_LIMIT';
    case 'insufficient_quota':
    case 'billing_error':
      return 'QUOTA';
    case 'overloaded_error':
    case 'api_error':
    case 'service_unavailable':
      return 'UPSTREAM';
    case 'invalid_request_error':
    case 'not_found_error':
      return 'CONFIG';
    case 'timeout':
      return 'TIMEOUT';
    case 'network_error':
      return 'NETWORK';
    default:
      return 'UNKNOWN';
  }
}

function classifyMessage(message: string): AppErrorCode {
  const lower = message.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => lower.includes(n));

  // IPC / channel plumbing — very specific, check first.
  if (has('invalid ipc channel', 'no handler registered', 'window is not defined', 'unsupported')) {
    return 'CHANNEL_UNAVAILABLE';
  }

  // Authentication / API key — before CONFIG so "invalid api key" isn't swallowed.
  if (
    has(
      'invalid authentication',
      'unauthorized',
      'auth failed',
      'authentication_error',
      'invalid api key',
      'incorrect api key',
      'api key',
      'apikey',
      '401',
      '密钥',
      '鉴权',
      '认证失败',
      '未授权',
      '登录失效',
      '登录已过期',
    )
  ) {
    return 'AUTH_INVALID';
  }

  // Quota / billing — before RATE_LIMIT/NETWORK; distinct from "too fast".
  if (
    has(
      'insufficient_quota',
      'insufficient quota',
      'insufficient balance',
      'billing',
      'credit',
      'payment',
      'quota',
      '余额不足',
      '额度',
      '配额',
      '欠费',
      '计费',
    )
  ) {
    return 'QUOTA';
  }

  // Rate limiting — frequency, distinct from quota.
  if (has('rate limit', 'rate_limit', 'too many requests', '429', '请求过于频繁', '请求太频繁', '限流')) {
    return 'RATE_LIMIT';
  }

  // Upstream model provider errors — before NETWORK so "service unavailable" lands here.
  if (
    has(
      'overloaded',
      'upstream',
      'provider error',
      'model error',
      'service unavailable',
      'bad gateway',
      '502',
      '503',
      '上游',
      '模型服务',
      '模型不可用',
    )
  ) {
    return 'UPSTREAM';
  }

  // Timeouts.
  if (has('timeout', 'timed out', 'abort', 'deadline', '超时')) {
    return 'TIMEOUT';
  }

  // Engine process / port — before WORKSPACE so "spawn ENOENT" stays here.
  if (
    has(
      'spawn',
      'exited with code',
      'process exited',
      'exited before',
      'crashed',
      'eaddrinuse',
      'address already in use',
      'gateway not running',
      'failed to start',
      '进程退出',
      '启动失败',
      '端口被占用',
      '端口已被使用',
      '端口冲突',
    )
  ) {
    return 'PROCESS_FAILED';
  }

  // Permissions.
  if (has('permission', 'forbidden', 'denied', 'eacces', 'eperm', '403', '权限', '拒绝访问', '禁止访问')) {
    return 'PERMISSION';
  }

  // Workspace / filesystem path errors.
  if (
    has(
      'enoent',
      'no such file',
      'not a directory',
      'enotdir',
      'is a directory',
      '工作区',
      '路径不存在',
      '目录不存在',
      '文件不存在',
    )
  ) {
    return 'WORKSPACE';
  }

  // Network connectivity.
  if (
    has(
      'network',
      'fetch',
      'econnrefused',
      'econnreset',
      'econnaborted',
      'enotfound',
      'getaddrinfo',
      'socket hang up',
      'dns',
      '网络',
      '连接失败',
      '无法连接',
      '连接被重置',
    )
  ) {
    return 'NETWORK';
  }

  // Gateway transport.
  if (has('gateway', 'websocket', 'ws closed', 'connection closed', 'disconnected', '网关')) {
    return 'GATEWAY';
  }

  // Configuration — broad keywords last.
  if (
    has(
      'config',
      'validation',
      'invalid',
      'missing',
      'not configured',
      'required',
      'unknown model',
      'model not found',
      '400',
      '配置',
      '未配置',
      '缺少',
      '无效',
    )
  ) {
    return 'CONFIG';
  }

  return 'UNKNOWN';
}

export function normalizeAppError(err: unknown, details?: Record<string, unknown>): AppError {
  if (err instanceof AppError) {
    return new AppError(err.code, err.message, err.cause ?? err, { ...(err.details ?? {}), ...(details ?? {}) });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new AppError(classifyMessage(message), message, err, details);
}
