/**
 * 顺序执行 Office 项目（Smart → Workflow），轮询状态并在完成后可选发飞书通知。
 *
 * 策略：仅调用 /api/office/* 与只读探测；不修改 YYClaw 全局配置（见 tests/unit/office-test-policy.mts）。
 *
 * 依赖：pnpm dev 已启动且 Gateway ready；~/.openclaw/office/.host-api-token.dev 存在。
 *
 * Usage:
 *   pnpm exec tsx scripts/office-run-projects.mts
 *   pnpm exec tsx scripts/office-run-projects.mts --notify-feishu
 *   pnpm exec tsx scripts/office-run-projects.mts --smart-only
 *   pnpm exec tsx scripts/office-run-projects.mts --dev-team --notify-feishu
 *   OFFICE_SMART_TASK_ID=task-xxx pnpm exec tsx scripts/office-run-projects.mts --smart-only
 *
 * Smart E2E 断言：task.status === 'completed'，且无 validation_fail 群聊行。
 * 引擎推进器（【引擎·推进】）在 kickoff/停滞/可结项时自动 @ 协调者或下一执行者。
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createOfficeTestFetch } from '../tests/unit/office-test-policy.mts';

const HOST_PORT = process.env.CLAWX_PORT_CLAWX_HOST_API ?? '13210';
const TOKEN_PATH = join(homedir(), '.openclaw', 'office', '.host-api-token.dev');
const DATA_PATH = join(homedir(), '.openclaw', 'office', 'data.json');
const testFetch = createOfficeTestFetch();

/** 默认：「启动团队与项目」场景下五子棋 Smart + Workflow 两项目（可用环境变量覆盖）。 */
const SMART_TASK_ID =
  process.env.OFFICE_SMART_TASK_ID?.trim() || 'task-1779946822022-d39646';
const WORKFLOW_TASK_ID =
  process.env.OFFICE_WORKFLOW_TASK_ID?.trim() || 'task-1779935756361-s311yy';

const POLL_MS = 15_000;
const SMART_MAX_MS = 90 * 60_000;
const WORKFLOW_MAX_MS = 120 * 60_000;
/** 从失败节点续跑时 gen-6～8 可能含加长验收/审计超时 */
const WORKFLOW_RESUME_MAX_MS = 150 * 60_000;

const FEISHU_NOTIFY_NAME = '我';
const FEISHU_USER_OPEN_ID = 'ou_aa826d152a4efccd830630aa28e0c2c0';

/** 办公协作 → 团队与项目 → 软件开发团队（按顺序执行） */
const DEV_TEAM_TASK_QUEUE: Array<{ id: string; label: string }> = [
  { id: 'task-1780146759230-5asb4j', label: '五子棋游戏开发' },
  { id: 'task-1780146825928-mw04mq', label: '象棋游戏开发' },
  { id: 'task-1780387975691-ex3qsm', label: 'Coding Agent工具' },
];

type TaskRow = {
  id: string;
  title?: string;
  status: string;
  executionMode?: string;
  nodeRuns?: Array<{ nodeId: string; status: string; error?: string }>;
};

async function loadToken(): Promise<string> {
  return (await readFile(TOKEN_PATH, 'utf8')).trim();
}

async function api<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await testFetch(`http://127.0.0.1:${HOST_PORT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: T & { error?: string; success?: boolean };
  try {
    json = JSON.parse(text) as T & { error?: string; success?: boolean };
  } catch {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json.error ?? text.slice(0, 200)}`);
  }
  return json;
}

async function loadTaskFromDisk(taskId: string): Promise<TaskRow | null> {
  const raw = await readFile(DATA_PATH, 'utf8');
  const store = JSON.parse(raw) as { tasks?: TaskRow[]; tempProjects?: TaskRow[] };
  const projects = store.tempProjects ?? store.tasks ?? [];
  return projects.find((t) => t.id === taskId) ?? null;
}

async function getTask(token: string, taskId: string): Promise<TaskRow> {
  const snap = await api<{ tasks: TaskRow[] }>(token, 'GET', '/api/office/snapshot');
  const hit = snap.tasks.find((t) => t.id === taskId);
  if (hit) return hit;
  const disk = await loadTaskFromDisk(taskId);
  if (disk) return disk;
  throw new Error(`Task not found: ${taskId}`);
}

function logTask(task: TaskRow): void {
  const mode = task.executionMode ?? '?';
  const runs = task.nodeRuns ?? [];
  const running = runs.filter((n) => n.status === 'running').map((n) => n.nodeId);
  const failed = runs.filter((n) => n.status === 'failed');
  const pending = runs.filter((n) => n.status === 'pending').length;
  console.log(
    `[${new Date().toISOString()}] ${task.title ?? task.id} status=${task.status} mode=${mode} running=${running.join(',') || '-'} pending=${pending} failed=${failed.length}`,
  );
  for (const f of failed.slice(0, 3)) {
    console.log(`  fail ${f.nodeId}: ${(f.error ?? '').slice(0, 120)}`);
  }
}

async function abortTask(token: string, taskId: string): Promise<void> {
  try {
    await api(token, 'POST', `/api/office/tasks/${encodeURIComponent(taskId)}/abort`);
    console.log(`[abort] ${taskId}`);
  } catch (e) {
    console.warn(`[abort] ${taskId} skipped:`, e instanceof Error ? e.message : e);
  }
}

async function runTask(
  token: string,
  taskId: string,
  mode: 'fresh' | 'continue',
  opts?: { clearProjectRoom?: boolean },
): Promise<void> {
  await api(token, 'POST', `/api/office/tasks/${encodeURIComponent(taskId)}/run`, {
    mode,
    ...(opts?.clearProjectRoom ? { clearProjectRoom: true } : {}),
  });
  console.log(`[run] ${taskId} mode=${mode}${opts?.clearProjectRoom ? ' clearRoom' : ''}`);
}

type RoomRow = { id: string; fromRoleId?: string; content?: string; timestamp: number };

function assertTaskCompleted(task: TaskRow, label: string): void {
  if (task.status !== 'completed') {
    throw new Error(`${label}: expected status=completed, got ${task.status}`);
  }
}

async function auditRoomMessages(taskId: string, token: string): Promise<string[]> {
  const issues: string[] = [];
  const res = await api<{ messages: RoomRow[] }>(
    token,
    'GET',
    `/api/office/tasks/${encodeURIComponent(taskId)}/room/messages`,
  );
  const msgs = res.messages ?? [];
  const seen = new Map<string, number>();
  for (const m of msgs) {
    const body = (m.content ?? '').replace(/\s+/g, ' ').trim();
    if (/模型回复未通过格式校验/u.test(body)) {
      issues.push(`validation_fail:${m.id}`);
    }
    if (/【引擎·推进】/u.test(body)) {
      console.log(`[audit] engine nudge: ${body.slice(0, 100)}`);
    }
    if (!m.fromRoleId || body.length < 8) continue;
    const key = `${m.fromRoleId}:${body.slice(0, 200)}`;
    const prev = seen.get(key);
    if (prev != null && m.timestamp - prev < 15_000) {
      issues.push(`duplicate:${m.fromRoleId}:${m.id}`);
    }
    seen.set(key, m.timestamp);
  }
  return issues;
}

async function postRoom(
  token: string,
  taskId: string,
  content: string,
): Promise<void> {
  await api(token, 'POST', `/api/office/tasks/${encodeURIComponent(taskId)}/room/messages`, {
    content,
  });
  console.log(`[room] posted ${content.slice(0, 80)}…`);
}

async function waitForGatewayReady(token: string, maxMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const gw = await api<{ state: string; gatewayReady?: boolean }>(
      token,
      'GET',
      '/api/gateway/status',
    );
    if (gw.state === 'running' && gw.gatewayReady) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Gateway not ready — start pnpm dev and wait until gatewayReady');
}

async function waitTask(
  token: string,
  taskId: string,
  maxMs: number,
  onStall?: () => Promise<void>,
  opts?: { requireFreshRun?: boolean },
): Promise<TaskRow> {
  const start = Date.now();
  let lastStatus = '';
  let stallRounds = 0;
  let lastNudge = 0;
  let sawActive = !opts?.requireFreshRun;
  let repostedContinue = false;

  while (Date.now() - start < maxMs) {
    const task = await getTask(await loadToken(), taskId);
    if (task.status === 'running' || task.status === 'pending') {
      sawActive = true;
    }
    if (task.status !== lastStatus) {
      logTask(task);
      lastStatus = task.status;
      stallRounds = 0;
    } else {
      stallRounds += 1;
    }

    if (task.status === 'completed' && sawActive) return task;
    if (task.status === 'failed') return task;
    if (
      opts?.requireFreshRun
      && !sawActive
      && Date.now() - start > 45_000
      && !repostedContinue
    ) {
      console.log(`[wait] ${taskId} 未进入 running，重试 continue`);
      await runTask(await loadToken(), taskId, 'continue');
      repostedContinue = true;
    }
    if (task.status === 'pending' && stallRounds > 2) {
      console.log(`[wait] ${taskId} pending — re-run continue`);
      await runTask(await loadToken(), taskId, 'continue');
      stallRounds = 0;
    }

    if (
      onStall
      && task.status === 'running'
      && stallRounds >= 8
      && Date.now() - lastNudge > 4 * 60_000
    ) {
      lastNudge = Date.now();
      stallRounds = 0;
      await onStall();
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timeout waiting for ${taskId} (${maxMs}ms)`);
}

async function resetWorkflowForContinue(taskId: string): Promise<void> {
  const raw = await readFile(DATA_PATH, 'utf8');
  const store = JSON.parse(raw) as {
    tasks?: Array<
      TaskRow & {
        workflow?: { nodes?: Array<{ id: string; title?: string; maxRuntimeMinutes?: number }> };
      }
    >;
    tempProjects?: Array<
      TaskRow & {
        workflow?: { nodes?: Array<{ id: string; title?: string; maxRuntimeMinutes?: number }> };
      }
    >;
  };
  const projects = store.tempProjects ?? store.tasks ?? [];
  const task = projects.find((t) => t.id === taskId);
  if (!task?.nodeRuns) return;
  for (const node of task.workflow?.nodes ?? []) {
    const title = node.title?.trim() ?? '';
    if (/测试验收|安全审计/u.test(title)) {
      node.maxRuntimeMinutes = Math.max(node.maxRuntimeMinutes ?? 30, 45);
    }
  }
  for (const nr of task.nodeRuns) {
    if (nr.status === 'failed' || nr.status === 'running') {
      nr.status = 'pending';
      delete nr.error;
      delete (nr as { runId?: string }).runId;
      delete (nr as { sessionKey?: string }).sessionKey;
      delete (nr as { completedAt?: number }).completedAt;
      delete (nr as { startedAt?: number }).startedAt;
      delete (nr as { edgeOutcome?: string }).edgeOutcome;
    }
  }
  task.status = 'pending';
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8'),
  );
  console.log(`[reset] workflow nodes → pending for ${taskId}`);
}

async function sendFeishuNotify(summary: string): Promise<void> {
  const cfgPath = join(homedir(), '.openclaw', 'openclaw.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as {
    channels?: { feishu?: { appId?: string; appSecret?: string } };
  };
  const feishu = cfg.channels?.feishu ?? {};
  const appId = feishu.appId?.trim() || process.env.FEISHU_APP_ID?.trim();
  const appSecret = feishu.appSecret?.trim() || process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.warn('[feishu] missing app credentials — skip notify');
    return;
  }

  const origin = 'https://open.feishu.cn';
  const tokenRes = await fetch(`${origin}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenJson = (await tokenRes.json()) as {
    code?: number;
    tenant_access_token?: string;
  };
  if (!tokenRes.ok || tokenJson.code !== 0 || !tokenJson.tenant_access_token) {
    console.warn('[feishu] tenant token failed');
    return;
  }

  const text = summary.slice(0, 4000);
  const msgRes = await fetch(
    `${origin}/open-apis/im/v1/messages?receive_id_type=open_id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenJson.tenant_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: FEISHU_USER_OPEN_ID,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );
  const msgJson = (await msgRes.json()) as { code?: number; msg?: string };
  if (!msgRes.ok || msgJson.code !== 0) {
    console.warn('[feishu] send failed:', msgJson.msg ?? msgRes.status);
    return;
  }
  console.log(`[feishu] notified ${FEISHU_NOTIFY_NAME} (${FEISHU_USER_OPEN_ID})`);
}

async function runDevTeamQueue(token: string, notifyFeishu: boolean): Promise<void> {
  const results: Array<{ title: string; id: string; status: string; note?: string }> = [];
  const smartNudge = async (taskId: string) => {
    await postRoom(
      token,
      taskId,
      [
        '@PM 请根据群聊进展验收或回流；要求成员交付须写项目目录下可 stat 的绝对路径，',
        '子任务完成后 @协调者 汇报；全部完成后在【群聊回复】末尾写 **项目结项**（禁止 @）。',
      ].join(''),
    );
  };

  for (let i = 0; i < DEV_TEAM_TASK_QUEUE.length; i++) {
    const item = DEV_TEAM_TASK_QUEUE[i]!;
    console.log(`\n=== [${i + 1}/${DEV_TEAM_TASK_QUEUE.length}] ${item.label} (${item.id}) ===`);

    for (const other of DEV_TEAM_TASK_QUEUE) {
      if (other.id !== item.id) await abortTask(token, other.id);
    }
    await new Promise((r) => setTimeout(r, 1500));
    await abortTask(token, item.id);
    await new Promise((r) => setTimeout(r, 1500));
    await runTask(token, item.id, 'fresh', { clearProjectRoom: true });
    await new Promise((r) => setTimeout(r, 2000));

    const before = await getTask(token, item.id);
    const isSmart = before.executionMode === 'smart';
    const maxMs = isSmart ? SMART_MAX_MS : WORKFLOW_MAX_MS;
    const onStall = isSmart ? () => smartNudge(item.id) : undefined;
    const task = await waitTask(token, item.id, maxMs, onStall, { requireFreshRun: true });
    const roomIssues = await auditRoomMessages(item.id, token);
    const ok =
      task.status === 'completed'
      && !roomIssues.some((issue) => issue.startsWith('validation_fail'));

    results.push({
      title: task.title ?? item.label,
      id: item.id,
      status: task.status,
      note: roomIssues.length ? `room_issues=${roomIssues.length}` : undefined,
    });

    if (!ok) {
      const failSummary = [
        '【Office·软件开发团队】执行未完成',
        `· ${item.label}：❌ ${task.status}`,
        ...results
          .filter((r) => r.status === 'completed')
          .map((r) => `· ${r.title}：✅ 已完成`),
        '',
        `时间：${new Date().toLocaleString('zh-CN')}`,
      ].join('\n');
      console.error('\n' + failSummary);
      if (notifyFeishu) await sendFeishuNotify(failSummary);
      process.exit(1);
    }

    await abortTask(token, item.id);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const lines = results.map((r) => `· ${r.title}：✅ 已完成`);
  const summary = [
    '【Office·软件开发团队】全部项目执行完成',
    ...lines,
    '',
    `时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\n');
  console.log('\n' + summary);
  if (notifyFeishu) await sendFeishuNotify(summary);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const devTeam = args.has('--dev-team');
  const notifyFeishu = args.has('--notify-feishu');
  const smartOnly = args.has('--smart-only');
  const workflowOnly = args.has('--workflow-only');
  const noReset = args.has('--no-reset');

  let token = await loadToken();
  await waitForGatewayReady(token);

  if (devTeam) {
    await runDevTeamQueue(token, notifyFeishu);
    return;
  }

  const results: Array<{ title: string; id: string; status: string; note?: string }> = [];

  if (!workflowOnly) {
    console.log('\n=== Phase 1: 五子棋游戏开发2 (Smart) ===');
    await abortTask(token, WORKFLOW_TASK_ID);
    await new Promise((r) => setTimeout(r, 1500));

    await abortTask(token, SMART_TASK_ID);
    await new Promise((r) => setTimeout(r, 1500));
    await runTask(token, SMART_TASK_ID, 'fresh', { clearProjectRoom: true });
    let smart = await getTask(token, SMART_TASK_ID);

    const smartNudge = async () => {
      await postRoom(
        token,
        SMART_TASK_ID,
        [
          '@PM 请根据群聊进展验收或回流；要求成员交付须写项目目录下可 stat 的绝对路径，',
          '子任务完成后 @协调者 汇报；全部完成后在【群聊回复】末尾写 **项目结项**（禁止 @）。',
        ].join(''),
      );
    };

    smart = await waitTask(token, SMART_TASK_ID, SMART_MAX_MS, smartNudge);
    const smartRoomIssues = await auditRoomMessages(SMART_TASK_ID, token);
    if (smartRoomIssues.length > 0) {
      console.warn('[smart] room audit:', smartRoomIssues.slice(0, 8).join('; '));
    }
    try {
      assertTaskCompleted(smart, 'Smart E2E');
    } catch (e) {
      console.error('[smart]', e instanceof Error ? e.message : e);
    }
    results.push({
      title: smart.title ?? '五子棋开发',
      id: SMART_TASK_ID,
      status: smart.status,
      note: smartRoomIssues.length ? `room_issues=${smartRoomIssues.length}` : undefined,
    });
    if (smart.status !== 'completed' || smartRoomIssues.some((i) => i.startsWith('validation_fail'))) {
      console.error('[smart] did not complete:', smart.status);
      if (notifyFeishu) {
        await sendFeishuNotify(
          ['【Office 项目执行结果】', `· 五子棋开发：❌ ${smart.status}（未完成）`, '', `时间：${new Date().toLocaleString('zh-CN')}`].join('\n'),
        );
      }
      process.exit(1);
    }
    await abortTask(token, SMART_TASK_ID);
  }

  if (workflowOnly) {
    const smartDone = await getTask(token, SMART_TASK_ID);
    if (smartDone.status !== 'completed') {
      throw new Error(
        `Smart 任务未完成（${smartDone.status}），请先跑通五子棋开发或去掉 --workflow-only`,
      );
    }
    results.push({
      title: smartDone.title ?? '五子棋开发',
      id: SMART_TASK_ID,
      status: smartDone.status,
    });
  }

  if (!smartOnly) {
    console.log('\n=== Phase 2: 五子棋游戏开发 (Workflow) ===');
    const wfBefore = await getTask(token, WORKFLOW_TASK_ID);
    const runs = wfBefore.nodeRuns ?? [];
    const wfResume =
      wfBefore.status !== 'completed'
      && runs.some((n) => n.status === 'completed')
      && runs.some((n) => n.status === 'failed' || n.status === 'pending' || n.status === 'running');
    if (wfResume) {
      console.log('[workflow] resume partial progress (skip abort/fresh)');
      if (!noReset) {
        await resetWorkflowForContinue(WORKFLOW_TASK_ID);
      } else {
        console.log('[workflow] --no-reset: keep completed nodeRuns on disk');
      }
      await runTask(token, WORKFLOW_TASK_ID, 'continue');
    } else {
      await abortTask(token, WORKFLOW_TASK_ID);
      await new Promise((r) => setTimeout(r, 2000));
      await runTask(token, WORKFLOW_TASK_ID, 'fresh', { clearProjectRoom: true });
    }

    const wfMaxMs = wfResume ? WORKFLOW_RESUME_MAX_MS : WORKFLOW_MAX_MS;
    const wf = await waitTask(token, WORKFLOW_TASK_ID, wfMaxMs);
    const wfRoomIssues = await auditRoomMessages(WORKFLOW_TASK_ID, token);
    if (wfRoomIssues.length > 0) {
      console.warn('[workflow] room audit:', wfRoomIssues.slice(0, 8).join('; '));
    }
    results.push({
      title: wf.title ?? '个税计算器开发',
      id: WORKFLOW_TASK_ID,
      status: wf.status,
      note: wfRoomIssues.length ? `room_issues=${wfRoomIssues.length}` : undefined,
    });
    if (wf.status !== 'completed' || wfRoomIssues.some((i) => i.startsWith('validation_fail'))) {
      console.error('[workflow] did not complete:', wf.status);
      process.exit(1);
    }
  }

  const lines = results.map(
    (r) => `· ${r.title}：${r.status === 'completed' ? '✅ 已完成' : `❌ ${r.status}`}`,
  );
  const summary = [`【Office 项目执行结果】`, ...lines, '', `时间：${new Date().toLocaleString('zh-CN')}`].join(
    '\n',
  );
  console.log('\n' + summary);

  if (notifyFeishu) {
    await sendFeishuNotify(summary);
  }
}

main().catch((err) => {
  console.error('[office-run-projects] Fatal:', err);
  process.exit(1);
});
