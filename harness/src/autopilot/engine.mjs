import { createActor, createMachine } from 'xstate';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePlan, digest, DEFAULT_BUDGET, workerResultSchema, topologicalTasks, scopesConflict } from './contracts.mjs';
import { atomicJson, RunStore } from './store.mjs';
import { assertClean, git, WorkspaceManager } from './workspaces.mjs';
import { isolatedEnvironment } from './adapters.mjs';
import { runStep } from '../runner.mjs';
import { runAcceptance, auditChanges } from './acceptance.mjs';
import { requiredTestStep } from '../validation.mjs';
import { requirementContext, validateSources, taskMarkdown } from './planner.mjs';

export const DEFAULT_CI_CHECKS = Object.freeze(['check', 'build', 'harness', 'comms-regression', 'Electron E2E (ubuntu-latest)', 'Electron E2E (macos-latest)', 'Electron E2E (windows-latest)']);
export const runMachine = createMachine({
  id: 'autopilot', initial: 'running', states: {
    running: { on: { COMPLETE: 'complete', BLOCK: 'blocked', FAIL: 'failed', CANCEL: 'cancelled', CLEANUP_FAILURE: 'cleanup-failed' } },
    blocked: { on: { RESUME: 'running' } }, failed: { on: { RESUME: 'running' } }, cancelled: { on: { RESUME: 'running' } },
    'cleanup-failed': { on: { RESUME: 'running' } }, complete: { type: 'final' },
  },
});

export class AutopilotEngine {
  constructor({ repo, artifactRoot, adapter, publisher, budget = {}, allowRisks = [], requiredCiChecks = DEFAULT_CI_CHECKS, externalEnv = {}, prepare, acceptance, baseline, executeStep = runStep, pollMs = 30000 }) {
    this.repo = path.resolve(repo);
    this.artifactRoot = path.resolve(artifactRoot);
    this.adapter = adapter;
    this.publisher = publisher;
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.allowRisks = allowRisks;
    this.requiredCiChecks = requiredCiChecks;
    this.externalEnv = externalEnv;
    this.prepareOverride = prepare;
    this.acceptanceOverride = acceptance;
    this.baselineOverride = baseline;
    this.executeStep = executeStep;
    this.pollMs = pollMs;
    this.prepared = new Set();
    if (!Number.isInteger(this.budget.concurrency) || this.budget.concurrency < 1 || this.budget.concurrency > 2 || !Number.isInteger(this.budget.maxRepairs) || this.budget.maxRepairs < 0 || !Number.isFinite(this.budget.durationMs) || this.budget.durationMs <= 0 || !Number.isInteger(this.budget.maxTasks) || this.budget.maxTasks < 1 || this.budget.maxTasks > 8 || !Number.isFinite(this.budget.commandTimeoutMs) || this.budget.commandTimeoutMs <= 0 || !requiredCiChecks.length) throw new Error('Invalid autonomous run limits');
  }

  async start(input) {
    await assertClean(this.repo);
    const requirements = await requirementContext(this.repo, input.featureId);
    const plan = validatePlan(input, { featureIds: requirements.featureIds, allowRisks: this.allowRisks });
    await validateSources(this.repo, plan);
    if (plan.tasks.length > this.budget.maxTasks || plan.baseSha !== await git(this.repo, ['rev-parse', 'HEAD'])) throw new Error('Plan exceeds budget or differs from committed input SHA');
    const remoteBase = await git(this.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${plan.targetBranch}`]);
    if (remoteBase.split(/\s+/)[0] !== plan.baseSha) throw new Error('Frozen input must match the published target branch; publish or synchronize baseline changes separately');
    await this.adapter.preflight?.();
    await this.publisher.preflight?.();
    const runId = `run-${randomUUID()}`;
    const store = new RunStore(this.artifactRoot, runId);
    const record = { schemaVersion: 1, runId, repo: this.repo, plan, planHash: digest(plan), budget: this.budget, allowRisks: this.allowRisks, requiredCiChecks: this.requiredCiChecks, startedAt: new Date().toISOString(), deadline: Date.now() + this.budget.durationMs, status: 'running', tasks: Object.fromEntries(plan.tasks.map((task) => [task.id, { id: task.id, status: 'pending', attempts: 0, repairs: 0, workspaces: [] }])) };
    await atomicJson(path.join(store.dir, 'plan.json'), plan);
    for (const task of plan.tasks) await writeFile(path.join(store.dir, `${task.id}.md`), taskMarkdown(task, plan.featureId));
    await store.save(record);
    return await this.execute(store, record);
  }

  async resume(runId) {
    await assertClean(this.repo);
    const store = new RunStore(this.artifactRoot, runId);
    const record = await store.read();
    if (record.repo !== this.repo || digest(record.plan) !== record.planHash) throw new Error('Run input/acceptance identity mismatch');
    validatePlan(record.plan, { allowRisks: record.allowRisks });
    this.budget = record.budget;
    this.allowRisks = record.allowRisks;
    this.requiredCiChecks = record.requiredCiChecks;
    if (record.status === 'complete') return record;
    if (record.deadline <= Date.now()) throw new Error('Run deadline exhausted; create a new bounded run after reviewing evidence');
    await this.adapter.preflight?.();
    await this.publisher.preflight?.();
    await rm(path.join(store.dir, 'cancel'), { force: true });
    return await this.execute(store, record);
  }

  async save() {
    await this.store.save(this.record);
  }

  async prepare(workspace, artifactDir) {
    if (this.prepared.has(workspace.resourceId)) return;
    await mkdir(path.join(workspace.home, 'tmp'), { recursive: true });
    if (this.prepareOverride) await this.prepareOverride(workspace, artifactDir);
    else {
      const result = await this.executeStep({ name: 'Install committed workspace dependencies', command: 'pnpm', args: ['install', '--frozen-lockfile'] }, { cwd: workspace.path, env: isolatedEnvironment(workspace.home), timeoutMs: this.remaining(), signal: this.controller.signal, logPath: path.join(artifactDir, 'install.log'), ...this.processHooks(workspace) });
      if (result.status !== 'pass') throw new Error(result.error ?? 'Workspace dependency initialization failed');
      const bridge = await this.executeStep({ name: 'Generate existing extension bridge', command: 'pnpm', args: ['run', 'ext:bridge'] }, { cwd: workspace.path, env: isolatedEnvironment(workspace.home), timeoutMs: this.remaining(), signal: this.controller.signal, logPath: path.join(artifactDir, 'extension-bridge.log'), ...this.processHooks(workspace) });
      if (bridge.status !== 'pass') throw new Error(bridge.error ?? 'Extension bridge initialization failed');
    }
    this.prepared.add(workspace.resourceId);
  }

  remaining() {
    const remaining = this.record.deadline - Date.now();
    if (remaining <= 0 || this.controller.signal.aborted) throw new Error('Run cancelled or budget exhausted');
    return Math.min(remaining, this.budget.commandTimeoutMs);
  }

  processHooks(workspace) {
    return { onSpawn: (child) => this.manager.registerProcess(workspace, child), onExit: (child) => this.manager.unregisterProcess(workspace, child) };
  }

  async withHostResources(operation) {
    const lease = new RunStore(this.artifactRoot, 'host-resources');
    let release;
    while (!release) {
      this.remaining();
      try { release = await lease.lock(); }
      catch (error) {
        if (!error.message.includes('active runner')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    try { return await operation(); }
    finally { await release(); }
  }

  async cleanup(state, workspace, publication) {
    state.status = 'cleaning';
    await this.save();
    const artifactDir = path.join(this.store.dir, 'tasks', state.id, workspace.resourceId);
    await this.manager.stopProcesses(workspace);
    state.archive = await this.manager.archive(workspace, path.join(artifactDir, 'archive'));
    await this.save();
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        state.cleanup = await this.manager.cleanup(workspace, state.archive, publication);
        state.workspace = null;
        await this.save();
        return;
      } catch (failure) { error = failure; }
    }
    state.status = 'cleanup-failed';
    state.error = error.message;
    await this.save();
    throw error;
  }

  async recoverWorkspaces() {
    for (const workspace of await this.manager.discover()) {
      const state = workspace.taskId === 'baseline' ? this.record.baseline : this.record.tasks[workspace.taskId];
      if (!state || state.workspace && state.workspace.resourceId !== workspace.resourceId) throw new Error('Unreconciled owned workspace requires review before new allocation');
      if (!state.workspace) {
        state.workspace = workspace;
        if (!state.workspaces.includes(workspace.resourceId)) state.workspaces.push(workspace.resourceId);
        await this.save();
      }
    }
    for (const state of [...Object.values(this.record.tasks), ...(this.record.baseline ? [this.record.baseline] : [])]) {
      if (!state.publication && state.intendedPublication && this.publisher.lookup) {
        state.publication = await this.publisher.lookup(state.intendedPublication);
        await this.save();
      }
      if (!state.workspace) continue;
      if (state.archive && !(await access(state.workspace.container).then(() => true, () => false))) {
        state.cleanup = await this.manager.cleanup(state.workspace, state.archive, state.publication);
        state.workspace = null;
      } else {
        const published = state.publication?.sha === await git(state.workspace.path, ['rev-parse', 'HEAD']).catch(() => null);
        const prior = state.workspace;
        await this.cleanup(state, prior, published ? state.publication : undefined);
        if (!published && state.archive) state.recovery = { archive: state.archive, baseSha: prior.baseSha, head: state.localSha ?? prior.baseSha };
      }
      state.status = state.publication ? 'waiting-ci' : 'pending';
      await this.save();
    }
  }

  async baseline() {
    if (this.record.baseline?.status === 'pass') return;
    const state = this.record.baseline = { id: 'baseline', status: 'checking', workspaces: [] };
    if (this.baselineOverride) {
      state.evidence = await this.baselineOverride();
      state.status = state.evidence.status;
      await this.save();
      if (state.status !== 'pass') throw new Error('Committed baseline checks failed');
      return;
    }
    const workspace = await this.manager.create('baseline', this.record.plan.baseSha);
    state.workspace = workspace;
    state.workspaces.push(workspace.resourceId);
    await this.save();
    const artifactDir = path.join(this.store.dir, 'baseline');
    await mkdir(artifactDir, { recursive: true });
    await this.prepare(workspace, artifactDir);
    state.steps = [];
    for (const command of ['pnpm run lint:check', 'pnpm run typecheck', 'pnpm test', 'pnpm run build:vite', 'pnpm run harness:ci']) {
      const result = await this.executeStep(requiredTestStep(command), { cwd: workspace.path, env: isolatedEnvironment(workspace.home), signal: this.controller.signal, timeoutMs: this.remaining(), logPath: path.join(artifactDir, `step-${state.steps.length}.log`), ...this.processHooks(workspace) });
      state.steps.push(result);
      await this.save();
      if (result.status !== 'pass') break;
    }
    const passed = state.steps.length === 5 && state.steps.every((step) => step.status === 'pass');
    await this.cleanup(state, workspace);
    state.status = passed ? 'pass' : 'fail';
    await this.save();
    if (!passed) throw new Error('Committed baseline is failing; repair it separately before autonomous development');
  }

  async develop(task, baseSha, changesSha) {
    const state = this.record.tasks[task.id];
    this.remaining();
    const workspace = await this.manager.create(task.id, baseSha);
    state.workspace = workspace;
    state.workspaces.push(workspace.resourceId);
    state.status = 'coding';
    await this.save();
    const artifactDir = path.join(this.store.dir, 'tasks', task.id, workspace.resourceId);
    await mkdir(artifactDir, { recursive: true });
    await this.prepare(workspace, artifactDir);
    if (state.recovery && !changesSha) {
      const recovery = state.recovery;
      const receipt = JSON.parse(await readFile(path.join(recovery.archive.artifactDir, 'archive.json'), 'utf8'));
      if (digest(receipt) !== recovery.archive.receiptHash) throw new Error('Recovery archive was altered');
      const patchFile = path.join(recovery.archive.artifactDir, 'recovery-from-base.patch');
      const recoveryPatch = await readFile(patchFile, 'utf8');
      if (digest(recoveryPatch) !== receipt.basePatchHash) throw new Error('Recovery patch was altered');
      if (recoveryPatch.length) await git(workspace.path, ['apply', '--3way', patchFile]);
      const { cp } = await import('node:fs/promises');
      for (const entry of receipt.inventory) {
        const source = path.join(recovery.archive.artifactDir, 'untracked', entry.file);
        if (digest(await readFile(source)) !== entry.hash) throw new Error('Recovery file was altered');
        await mkdir(path.dirname(path.join(workspace.path, entry.file)), { recursive: true });
        await cp(source, path.join(workspace.path, entry.file), { errorOnExist: true, force: false });
      }
      state.recovery = null;
      await this.save();
    }
    if (changesSha && changesSha !== baseSha) {
      const parent = await git(this.repo, ['rev-parse', `${changesSha}^`]);
      const diff = await git(this.repo, ['diff', '--binary', parent, changesSha]);
      const patchFile = path.join(artifactDir, 'integration.patch');
      await writeFile(patchFile, diff);
      if (diff) await git(workspace.path, ['apply', '--3way', patchFile]);
    }
    for (;;) {
      this.remaining();
      if (state.attempts >= this.budget.maxRepairs + 1 && !changesSha) throw new Error('Task attempt budget exhausted');
      const attemptDir = path.join(artifactDir, `attempt-${++state.attempts}`);
      await mkdir(attemptDir, { recursive: true });
      await this.save();
      const audit = await auditChanges(workspace, task, this.allowRisks);
      if (audit.failures.length) throw new Error(audit.failures.join('\n'));
      const originalHead = await git(workspace.path, ['rev-parse', 'HEAD']);
      const response = await this.adapter.execute({ workspace, artifactDir: path.join(attemptDir, 'coding'), schema: workerResultSchema, signal: this.controller.signal, timeoutMs: this.remaining(), ...this.processHooks(workspace),
        prompt: `Implement ONLY this frozen task. Do not modify its acceptance or requirements. Never commit, push, create PRs, weaken/delete tests, change gates, read publishing credentials or use private user data. Write only exact allowed paths. Read AGENTS.md, code and tests; add meaningful positive and negative tests. Relevant docs/i18n belong in the declared scope. Report blocked if an undeclared protected change or prerequisite is necessary. Frozen task: ${JSON.stringify(task)}\nPrevious actual failures/CI: ${JSON.stringify(state.evidence ?? state.ci ?? null)}`,
      });
      state.sessionId = response.sessionId;
      if (await git(workspace.path, ['rev-parse', 'HEAD']) !== originalHead) throw new Error('Coding agent created unauthorized commits');
      state.worker = response.output;
      if (response.output.status === 'blocked') {
        state.error = response.output.blockers.join('\n');
        await this.cleanup(state, workspace);
        state.status = 'blocked';
        await this.save();
        return null;
      }
      const finalAudit = await auditChanges(workspace, task, this.allowRisks);
      if (finalAudit.failures.length) throw new Error(finalAudit.failures.join('\n'));
      state.status = 'accepting';
      await this.save();
      state.evidence = await this.withHostResources(async () => this.acceptanceOverride ? await this.acceptanceOverride({ task, workspace, artifactDir: attemptDir, state }) : await runAcceptance({ task, workspace, artifactDir: attemptDir, signal: this.controller.signal, timeoutMs: this.remaining(), allowRisks: this.allowRisks, adapter: this.adapter, executeStep: this.executeStep, externalEnv: this.externalEnv, processHooks: this.processHooks(workspace) }));
      const acceptedAudit = await auditChanges(workspace, task, this.allowRisks);
      if (acceptedAudit.failures.length) throw new Error(acceptedAudit.failures.join('\n'));
      if (await git(workspace.path, ['rev-parse', 'HEAD']) !== originalHead) throw new Error('Acceptance created unauthorized commits');
      await this.save();
      if (state.evidence.status === 'pass') {
        if (!finalAudit.files.length) throw new Error('No implementation changes; cannot deliver a task by assertion alone');
        await git(workspace.path, ['add', '--', ...acceptedAudit.files]);
        await git(workspace.path, ['-c', 'user.name=YYClaw Autopilot', '-c', 'user.email=autopilot@yyclaw.local', 'commit', '-m', `feat(${this.record.plan.featureId}): ${task.title}`]);
        state.localSha = await git(workspace.path, ['rev-parse', 'HEAD']);
        state.evidence.sha = state.localSha;
        state.status = 'local-pass';
        await this.save();
        return workspace;
      }
      if (this.controller.signal.aborted) throw new Error('Run cancelled during acceptance');
      if (state.evidence.status === 'blocked' || state.repairs >= this.budget.maxRepairs) {
        await this.cleanup(state, workspace);
        state.status = state.evidence.status === 'blocked' ? 'blocked' : 'failed';
        await this.save();
        return null;
      }
      state.repairs++;
      await this.save();
    }
  }

  async publish(task, workspace, base) {
    const state = this.record.tasks[task.id];
    const branch = `codex/autopilot-${this.record.runId.slice(4)}-${task.id}`;
    state.status = 'publishing';
    state.intendedPublication = { branch, base, sha: state.localSha };
    await this.save();
    const artifactDir = path.join(this.store.dir, 'tasks', task.id, workspace.resourceId);
    const body = [`# ${task.title}`, `Feature: ${this.record.plan.featureId}; task: ${task.id}`, `Base: ${base}`, `SHA: ${state.localSha}`, `Frozen plan: ${this.record.planHash}`, '', '## Acceptance evidence', '```json', JSON.stringify(state.evidence, null, 2), '```', '', '## Dependencies', ...task.dependencies.map((id) => `- ${id}: ${this.record.tasks[id].publication?.url ?? 'not published'}`), '', '## Excluded scope', ...task.exclusions.map((entry) => `- ${entry}`), '', 'This is branch implementation evidence, not a claim that the feature is merged. Owned workspace cleanup precedes CI tracking.'].join('\n');
    state.publication = await this.publisher.publish({ branch, base, sha: state.localSha, title: task.title, body, artifactDir });
    await this.save();
    await this.cleanup(state, workspace, state.publication);
    state.status = 'waiting-ci';
    await this.save();
  }

  async buildStack(tasks, repairFrom) {
    let stackSha = this.record.plan.baseSha;
    let stackBranch = this.record.plan.targetBranch;
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      const state = this.record.tasks[task.id];
      if (repairFrom === undefined && ['blocked', 'failed', 'cleanup-failed'].includes(state.status) && !state.publication) return false;
      if (repairFrom !== undefined && index >= repairFrom) {
        const prior = state.publication?.sha;
        const workspace = await this.develop(task, stackSha, prior);
        if (!workspace) return false;
        await this.publish(task, workspace, stackBranch);
      } else if (state.publication) {
        stackSha = state.publication.sha;
        stackBranch = state.publication.branch;
        continue;
      } else {
        let workspace = state.workspace;
        if (!workspace) workspace = await this.develop(task, stackSha);
        if (!workspace) return false;
        if (workspace.baseSha !== stackSha) {
          const changesSha = state.localSha;
          await this.cleanup(state, workspace);
          workspace = await this.develop(task, stackSha, changesSha);
          if (!workspace) return false;
        }
        await this.publish(task, workspace, stackBranch);
      }
      stackSha = state.publication.sha;
      stackBranch = state.publication.branch;
    }
    return true;
  }

  async execute(store, record) {
    const unlock = await store.lock();
    this.store = store;
    this.record = record;
    this.manager = new WorkspaceManager(this.repo, store);
    this.controller = new AbortController();
    const actor = createActor(runMachine).start();
    const cancellation = setInterval(() => {
      void store.cancelled().then((cancelled) => { if (cancelled || Date.now() >= record.deadline) this.controller.abort(); });
    }, 250);
    try {
      record.status = 'running';
      await this.recoverWorkspaces();
      await this.withHostResources(() => this.baseline());
      const tasks = topologicalTasks(record.plan);
      for (const state of Object.values(record.tasks)) if (!state.publication && !state.workspace && state.status !== 'pending') state.status = 'pending';
      const eligible = tasks.filter((task) => !task.dependencies.length && !record.tasks[task.id].publication && record.tasks[task.id].status === 'pending');
      const first = eligible[0];
      const second = eligible.find((task) => task !== first && !scopesConflict(first, task));
      const batch = [first, ...(this.budget.concurrency === 2 ? [second] : [])].filter(Boolean);
      await Promise.allSettled(batch.map((task) => this.develop(task, record.plan.baseSha))).then((results) => {
      const failed = results.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
      });
      if (!await this.buildStack(tasks)) {
        for (const task of tasks) {
          const state = record.tasks[task.id];
          if (!state.publication && !state.workspace && state.status === 'pending') {
            state.status = 'blocked';
            state.error = 'A required predecessor did not pass local acceptance';
          }
        }
        actor.send({ type: 'BLOCK' });
      }
      else {
        for (;;) {
          this.remaining();
          let repairFrom;
          let pending = false;
          for (let index = 0; index < tasks.length; index++) {
            const state = record.tasks[tasks[index].id];
            state.ci = await this.publisher.checks(state.publication, this.requiredCiChecks);
            if (state.ci.status === 'blocked') throw new Error(state.ci.reason);
            if (state.ci.status === 'fail') { repairFrom = index; break; }
            if (state.ci.status !== 'pass') pending = true;
          }
          await this.save();
          if (repairFrom !== undefined) {
            const state = record.tasks[tasks[repairFrom].id];
            if (state.repairs >= this.budget.maxRepairs) throw new Error('CI repair budget exhausted');
            state.repairs++;
            if (!await this.buildStack(tasks, repairFrom)) { actor.send({ type: 'BLOCK' }); break; }
            continue;
          }
          if (!pending) {
            for (const task of tasks) {
              const state = record.tasks[task.id];
              if (!state.cleanup || state.workspace || state.evidence.sha !== state.publication.sha) throw new Error('Current publication lacks accepted SHA and verified cleanup');
              await this.publisher.ready(state.publication);
              state.status = 'complete';
            }
            actor.send({ type: 'COMPLETE' });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(this.pollMs, this.record.deadline - Date.now())));
        }
      }
    } catch (error) {
      record.error = error.message;
      this.controller.abort();
      for (const state of Object.values(record.tasks)) if (state.workspace && !state.error) state.error = error.message;
      actor.send({ type: [...Object.values(record.tasks), ...(record.baseline ? [record.baseline] : [])].some((state) => state.status === 'cleanup-failed') ? 'CLEANUP_FAILURE' : await store.cancelled() ? 'CANCEL' : 'FAIL' });
    } finally {
      clearInterval(cancellation);
      for (const state of [...Object.values(record.tasks), ...(record.baseline ? [record.baseline] : [])]) {
        if (!state.workspace || state.status === 'cleanup-failed') continue;
        try {
          const priorStatus = state.status;
          const publication = state.publication?.sha === await git(state.workspace.path, ['rev-parse', 'HEAD']).catch(() => null) ? state.publication : undefined;
          await this.cleanup(state, state.workspace, publication);
          if (!publication) state.recovery = { archive: state.archive };
          state.status = publication ? 'waiting-ci' : priorStatus === 'blocked' ? 'blocked' : 'failed';
        } catch (error) { record.error = error.message; actor.send({ type: 'CLEANUP_FAILURE' }); }
      }
      record.status = String(actor.getSnapshot().value);
      if (Object.values(record.tasks).some((state) => state.workspace || state.status === 'cleanup-failed') || record.baseline?.workspace) record.status = 'cleanup-failed';
      record.machineSnapshot = actor.getPersistedSnapshot();
      await this.save();
      await atomicJson(path.join(store.dir, 'summary.json'), { runId: record.runId, status: record.status, featureId: record.plan.featureId, merged: false, exclusions: record.plan.exclusions, tasks: Object.values(record.tasks).map((state) => ({ id: state.id, status: state.status, publication: state.publication, cleanup: state.cleanup, error: state.error })) });
      actor.stop();
      await unlock();
    }
    return record;
  }
}
