/**
 * 办公协作测试脚本策略：不得修改 YYClaw 全局配置。
 *
 * 允许：
 * - 读写 /api/office/*（办公协作数据：场景、任务、角色、运行状态等）
 * - 任意 GET（只读探测，如 /api/gateway/status）
 *
 * 禁止（写操作）：
 * - /api/agents、/api/provider-accounts、/api/settings、/api/channels 等全局配置
 *
 * 维护脚本（如清除 mock 污染）须显式设置 OFFICE_ALLOW_CONFIG_MUTATION=1。
 */

export const OFFICE_TEST_FORBIDDEN_WRITE_PREFIXES = [
  '/api/agents',
  '/api/provider-accounts',
  '/api/settings',
  '/api/channels',
] as const;

export function isOfficeTestWriteAllowed(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') {
    return true;
  }
  const normalized = (path.split('?')[0] ?? path).trim();
  if (normalized.startsWith('/api/office/') || normalized === '/api/office') {
    return true;
  }
  return !OFFICE_TEST_FORBIDDEN_WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function assertOfficeTestMayWrite(method: string, path: string): void {
  if (process.env.OFFICE_ALLOW_CONFIG_MUTATION === '1') {
    return;
  }
  if (isOfficeTestWriteAllowed(method, path)) {
    return;
  }
  throw new Error(
    `[office-test-policy] Forbidden ${method} ${path}: office test scripts must not modify YYClaw global config. `
    + 'Only /api/office/* writes are allowed. Maintenance scripts may set OFFICE_ALLOW_CONFIG_MUTATION=1.',
  );
}

export function createOfficeTestFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method =
      init?.method
      ?? (typeof input === 'object' && input !== null && 'method' in input
        ? String((input as Request).method)
        : 'GET');
    const path = new URL(url, 'http://127.0.0.1').pathname;
    assertOfficeTestMayWrite(method, path);
    return baseFetch(input, init);
  };
}

/** @deprecated Use createOfficeTestFetch — alias for script imports */
export const officeTestFetch = createOfficeTestFetch;
