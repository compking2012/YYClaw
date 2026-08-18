import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the single-shot model client so generation is deterministic & offline.
const callModelOnce = vi.fn();
vi.mock('@electron/workflow/model-client', () => ({
  callModelOnce: (...args: unknown[]) => callModelOnce(...args),
}));

import { generateDynamicWorkflow } from '@electron/workflow/dynamic/generate';

afterEach(() => {
  callModelOnce.mockReset();
});

describe('generateDynamicWorkflow', () => {
  it('builds a linear definition with chained inputs from a suitable task', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        title: '数据报告',
        steps: [
          { id: 'fetch', title: '抓取', goal: '抓取 {{goal}} 的数据', inputsFrom: [] },
          { id: 'summarize', title: '汇总', goal: '汇总 {{fetch}}', inputsFrom: ['fetch'] },
          { id: 'verify', title: '校验', goal: '校验 {{summarize}}', inputsFrom: ['summarize'] },
        ],
      }),
    });

    const def = await generateDynamicWorkflow('做一份数据报告');
    expect(def).not.toBeNull();
    expect(def!.title).toBe('数据报告');
    expect(def!.goal).toBe('做一份数据报告');
    expect(def!.entry).toBe('fetch');
    // A synthesis step is appended to fold all node outputs into one
    // user-facing reply; it becomes the terminal step. It's an `agent` step so
    // its free-text reply isn't forced through a JSON schema.
    expect(def!.steps.map((s) => s.id)).toEqual(['fetch', 'summarize', 'verify', 'synthesize']);
    expect(def!.steps.map((s) => s.next)).toEqual(['summarize', 'verify', 'synthesize', null]);
    expect(def!.steps.every((s) => s.kind === 'agent')).toBe(true);
    const synth = def!.steps[3];
    expect(synth.next).toBeNull();
    expect(synth.inputsFrom).toEqual(['fetch', 'summarize', 'verify']);
    expect(synth.goalTemplate).toContain('{{fetch}}');
    expect(def!.steps[1].goalTemplate).toBe('汇总 {{fetch}}');
  });

  it('returns null when the model deems the task unsuitable', async () => {
    callModelOnce.mockResolvedValue({ text: JSON.stringify({ suitable: false }) });
    expect(await generateDynamicWorkflow('今天几号？')).toBeNull();
  });

  it('returns null for fewer than 3 steps (2-step "decompositions" are usually over-split)', () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        steps: [
          { id: 'a', title: 'A', goal: 'do a' },
          { id: 'b', title: 'B', goal: 'do b' },
        ],
      }),
    });
    return expect(generateDynamicWorkflow('两步任务')).resolves.toBeNull();
  });

  it('returns null when generation/parse fails on both attempts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    callModelOnce.mockResolvedValue({ text: 'not json at all' });
    expect(await generateDynamicWorkflow('坏输出')).toBeNull();
    expect(callModelOnce).toHaveBeenCalledTimes(2); // one retry
    // The failure is surfaced (not silently swallowed) so "never enters
    // workflow" is diagnosable.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('forwards providerId/model/timeout options to the model client', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        steps: [
          { id: 'a', title: 'A', goal: 'do a' },
          { id: 'b', title: 'B', goal: 'do b' },
        ],
      }),
    });

    await generateDynamicWorkflow('x', { providerId: 'p-1', model: 'm-1', timeoutMs: 1234 });
    expect(callModelOnce).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'p-1', model: 'm-1', timeoutMs: 1234 }),
    );
  });

  it('instructs the model not to prefix step titles with sequencing words', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        steps: [
          { id: 'a', title: '调研市场', goal: 'do a' },
          { id: 'b', title: '编写方案', goal: 'do b' },
        ],
      }),
    });

    await generateDynamicWorkflow('x');
    expect(callModelOnce).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('引导词') }),
    );
  });

  it('sanitizes ids and rewrites placeholders/inputsFrom consistently', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        steps: [
          { id: 'Fetch Data', title: '抓取', goal: 'get it' },
          { id: 'sum', title: '汇总', goal: '用 {{Fetch Data}} 汇总', inputsFrom: ['Fetch Data'] },
          { id: 'report', title: '报告', goal: '基于 {{sum}} 出报告', inputsFrom: ['sum'] },
        ],
      }),
    });

    const def = await generateDynamicWorkflow('x');
    expect(def).not.toBeNull();
    const [first, second] = def!.steps;
    expect(first.id).toBe('fetch_data');
    expect(second.goalTemplate).toBe('用 {{fetch_data}} 汇总');
    expect(second.inputsFrom).toEqual(['fetch_data']);
  });

  it('uses the injected runOnce (gateway path) instead of the direct callModelOnce', async () => {
    // Production injects a gateway-backed runner so generation uses the same
    // model + auth as the conversation (incl. OAuth-only primaries).
    const runOnce = vi.fn().mockResolvedValue(
      JSON.stringify({
        suitable: true,
        steps: [
          { id: 'a', title: 'A', goal: 'do a' },
          { id: 'b', title: 'B', goal: 'do b {{a}}', inputsFrom: ['a'] },
          { id: 'c', title: 'C', goal: 'do c {{b}}', inputsFrom: ['b'] },
        ],
      }),
    );

    const def = await generateDynamicWorkflow('x', { runOnce, agentId: 'main' });
    expect(def).not.toBeNull();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(callModelOnce).not.toHaveBeenCalled();
    expect(runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.any(String), input: expect.any(String) }),
    );
    expect(def!.steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'synthesize']);
  });

  it('returns null when the injected runOnce keeps failing (gateway 404/timeout)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runOnce = vi.fn().mockRejectedValue(new Error('gateway turn timed out'));
    expect(await generateDynamicWorkflow('x', { runOnce })).toBeNull();
    expect(runOnce).toHaveBeenCalledTimes(2); // one retry
    expect(callModelOnce).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('defers to a matched installed skill instead of decomposing, via onSkillMatch', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({ suitable: false, matchedSkill: 'travel-planner' }),
    });
    const onSkillMatch = vi.fn();

    const def = await generateDynamicWorkflow('帮我规划一份去云南的旅游攻略', {
      skills: [{ name: 'travel-planner', description: '帮用户规划旅游行程' }],
      onSkillMatch,
    });

    expect(def).toBeNull();
    expect(onSkillMatch).toHaveBeenCalledExactlyOnceWith('travel-planner');
  });

  it('includes the candidate skills list in the prompt sent to the model', async () => {
    callModelOnce.mockResolvedValue({ text: JSON.stringify({ suitable: false }) });

    await generateDynamicWorkflow('帮我规划一份去云南的旅游攻略', {
      skills: [{ name: 'travel-planner', description: '帮用户规划旅游行程' }],
    });

    expect(callModelOnce).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('travel-planner') }),
    );
  });
});

describe('generateDynamicWorkflow — merged resume triage', () => {
  const resumable = {
    title: '数据报告',
    steps: [
      { title: '抓取', status: 'done' as const },
      { title: '汇总', status: 'failed' as const },
      { title: '校验', status: 'pending' as const },
    ],
    error: 'boom at summarize',
  };

  it('returns null and fires onResume when the model judges the turn a resume', async () => {
    callModelOnce.mockResolvedValue({ text: JSON.stringify({ resume: true }) });
    const onResume = vi.fn();
    const def = await generateDynamicWorkflow('继续', { resumable, onResume });
    expect(def).toBeNull();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('builds a new workflow (onResume not fired) when the model does NOT judge it a resume', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        suitable: true,
        steps: [
          { id: 'a', title: 'A', goal: 'do a' },
          { id: 'b', title: 'B', goal: 'do b' },
          { id: 'c', title: 'C', goal: 'do c' },
        ],
      }),
    });
    const onResume = vi.fn();
    const def = await generateDynamicWorkflow('做一个全新的多步任务', { resumable, onResume });
    expect(def).not.toBeNull();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('ignores resume:true when no resumable context was provided (no onResume path)', async () => {
    callModelOnce.mockResolvedValue({ text: JSON.stringify({ resume: true }) });
    expect(await generateDynamicWorkflow('继续')).toBeNull();
  });

  it('injects the unfinished-run preamble into the prompt when resumable is provided', async () => {
    callModelOnce.mockResolvedValue({ text: JSON.stringify({ resume: true }) });
    await generateDynamicWorkflow('继续', { resumable, onResume: vi.fn() });
    expect(callModelOnce).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('尚未完成的工作流') }),
    );
  });
});
