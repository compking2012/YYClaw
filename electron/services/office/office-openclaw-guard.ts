import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';

export class OfficeOpenClawWriteFrozenError extends Error {
  readonly code = 'OFFICE_OPENCLAW_WRITE_FROZEN' as const;

  constructor(
    public readonly caller: string,
    public readonly executingProjectIds: string[] = [],
  ) {
    super(
      executingProjectIds.length > 0
        ? `Office 项目执行中，禁止写入 openclaw.json（${caller}）`
        : `Office 项目执行中，禁止写入 openclaw.json（${caller}）`,
    );
    this.name = 'OfficeOpenClawWriteFrozenError';
  }
}

/** 从 store 列出正在执行的项目 id（与 Renderer isOfficeProjectExecuting 一致）。 */
export async function listExecutingOfficeProjectIds(): Promise<string[]> {
  const { listTempProjects } = await import('./store');
  const projects = await listTempProjects();
  return projects
    .filter((p) => (p.lifecycle ?? 'active') === 'active' && isOfficeProjectExecuting(p))
    .map((p) => p.id);
}

/** 是否存在正在执行的 Office 项目（内存 run ref + store 状态）。 */
export async function isAnyOfficeProjectExecuting(): Promise<boolean> {
  const { isOfficeProjectExecutionActiveInMemory } = await import('./office-sync-runtime');
  if (isOfficeProjectExecutionActiveInMemory()) return true;
  const ids = await listExecutingOfficeProjectIds();
  return ids.length > 0;
}

/** Office 项目执行中禁止写 openclaw.json；否则抛出 OfficeOpenClawWriteFrozenError。
 *  Spawn tool deny reconcile (`office-spawn-policy-reconcile`) is exempt — it writes tools.deny only. */
export async function assertOfficeOpenClawWriteAllowed(caller: string): Promise<void> {
  const { isOfficeProjectExecutionActiveInMemory } = await import('./office-sync-runtime');
  if (isOfficeProjectExecutionActiveInMemory()) {
    throw new OfficeOpenClawWriteFrozenError(caller);
  }
  const executingIds = await listExecutingOfficeProjectIds();
  if (executingIds.length > 0) {
    throw new OfficeOpenClawWriteFrozenError(caller, executingIds);
  }
}
