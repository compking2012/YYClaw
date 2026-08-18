import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearTaskUserAborted,
  markTaskUserAborted,
  resolveOfficeTaskAbortMessage,
  setOfficeTaskAbortReason,
  clearOfficeTaskAbortReason,
  stampWorkflowParallelReworkBatchAbortReason,
  clearWorkflowParallelReworkBatchAbortReason,
  WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE,
} from '../../electron/services/office/task-run-abort-registry';

describe('resolveOfficeTaskAbortMessage', () => {
  const taskId = 'task-abort-msg-ut';

  beforeEach(() => {
    clearTaskUserAborted(taskId);
    clearOfficeTaskAbortReason(taskId);
  });

  it('uses stored reason when present', () => {
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('网关进程已停止（stopped）');
  });

  it('uses user-abort copy when user aborted', () => {
    markTaskUserAborted(taskId);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('用户已手动中止本项目');
  });

  it('default interrupt copy is neutral (no gateway-restart scare wording)', () => {
    const msg = resolveOfficeTaskAbortMessage(taskId);
    expect(msg).toBe('任务执行被中断，请稍后点击续跑');
    expect(msg).not.toContain('网关重启');
    expect(msg).not.toContain('重新执行覆盖');
  });

  it('parallel-batch rework abort copy explains sibling stop (not generic interrupt)', () => {
    expect(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE).toContain('并行步骤');
    expect(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE).toContain('工作流回流');
    expect(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE).toContain('非本步故障');
    expect(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE).not.toContain('网关重启');

    expect(stampWorkflowParallelReworkBatchAbortReason(taskId)).toBe(true);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);

    clearWorkflowParallelReworkBatchAbortReason(taskId);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('任务执行被中断，请稍后点击续跑');
  });
});

describe('parallel-rework batch abort reason (suspect → reproduce → fix)', () => {
  const taskId = 'task-abort-rework-batch-ut';

  beforeEach(() => {
    clearTaskUserAborted(taskId);
    clearOfficeTaskAbortReason(taskId);
  });

  it('suspect1: unconditional clear after batch would wipe a later gateway abort reason', () => {
    // Reproduce pre-fix batch finally: clearOfficeTaskAbortReason(taskId) always.
    setOfficeTaskAbortReason(taskId, WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    clearOfficeTaskAbortReason(taskId);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('任务执行被中断，请稍后点击续跑');

    // Fixed: only clear when still holding the parallel-rework stamp.
    setOfficeTaskAbortReason(taskId, WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    clearWorkflowParallelReworkBatchAbortReason(taskId);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('网关进程已停止（stopped）');
  });

  it('suspect2: raw set overwrites existing abort reason; stamp must be no-op when occupied', () => {
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    // Pre-fix: setOfficeTaskAbortReason(taskId, WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE)
    setOfficeTaskAbortReason(taskId, WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe(WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);

    clearOfficeTaskAbortReason(taskId);
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    expect(stampWorkflowParallelReworkBatchAbortReason(taskId)).toBe(false);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('网关进程已停止（stopped）');
  });

  it('suspect2b: stamp must not override user-aborted tasks', () => {
    markTaskUserAborted(taskId);
    expect(stampWorkflowParallelReworkBatchAbortReason(taskId)).toBe(false);
    expect(resolveOfficeTaskAbortMessage(taskId)).toBe('用户已手动中止本项目');
  });

  it('clear parallel-rework stamp is a no-op when reason already changed', () => {
    expect(stampWorkflowParallelReworkBatchAbortReason(taskId)).toBe(true);
    setOfficeTaskAbortReason(taskId, '网关进程已停止（stopped）');
    clearWorkflowParallelReworkBatchAbortReason(taskId);
    expect(peekKept()).toBe('网关进程已停止（stopped）');

    function peekKept() {
      return resolveOfficeTaskAbortMessage(taskId);
    }
  });
});
