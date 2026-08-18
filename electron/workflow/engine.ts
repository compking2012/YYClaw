// @ts-nocheck
/**
 * WorkflowEngine — the deterministic orchestration kernel.
 *
 * Owns the XState actor lifecycle, the definition registry, snapshot
 * persistence, and the `workflow:progress` event stream. Electron-free by
 * design: the singleton (with the real adapter + userData-backed snapshot store)
 * is assembled in `./index.ts`, while tests construct an engine directly with a
 * fake adapter and a temp-dir store.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createActor, type Actor, type AnyStateMachine, type SnapshotFrom } from 'xstate';
import type { OpenClawAdapter } from './adapter/openclaw-adapter';
import type { SnapshotStore } from './snapshot-store';
import type { RunRecord, RunStatus, StepKind, TraceEntry, WorkflowDefinition } from './types';
import { compileDynamicDefinition } from './dynamic/compile';
import type { DynamicWorkflowDefinition } from './dynamic/types';

/** Name of the conventional terminal-failure state in a workflow machine. */
const FAILURE_STATE = 'failed';

export interface WorkflowEngineDeps {
  adapter: OpenClawAdapter;
  store: SnapshotStore;
}

function stringifyState(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export class WorkflowEngine extends EventEmitter {
  private readonly defs = new Map<string, WorkflowDefinition>();
  /** Raw data-driven definitions for dynamic runs, kept so they can be persisted
   *  (into each SnapshotRecord) and rebuilt after a restart. */
  private readonly dynamicDefs = new Map<string, DynamicWorkflowDefinition>();
  private readonly actors = new Map<string, Actor<AnyStateMachine>>();
  private readonly records = new Map<string, RunRecord>();
  /** Runs being aborted — suppresses the stop-triggered transition callback. */
  private readonly aborting = new Set<string>();

  constructor(private readonly deps: WorkflowEngineDeps) {
    super();
  }

  register(def: WorkflowDefinition): void {
    this.defs.set(def.id, def);
  }

  /**
   * Register a data-driven dynamic workflow (typically Agent-generated): compiles
   * it into a standard definition (XState machine + stepKinds) and registers it,
   * so it runs through the exact same start/resume/snapshot/progress machinery.
   * The raw def is retained (and persisted per-run) so a restarted engine can
   * rebuild it for resume/retry.
   */
  registerDynamic(def: DynamicWorkflowDefinition): void {
    this.dynamicDefs.set(def.id, def);
    this.register(compileDynamicDefinition(def));
  }

  /**
   * Rebuild a dynamic definition from a persisted record when the in-memory
   * registry lacks it (e.g. after a process restart). No-op for built-ins or
   * records without a persisted definition.
   */
  private ensureRegistered(record: { defId: string; definition?: DynamicWorkflowDefinition }): void {
    if (!this.defs.has(record.defId) && record.definition) {
      this.registerDynamic(record.definition);
    }
  }

  listDefinitions(): Array<{ id: string; title: string; version: number }> {
    return [...this.defs.values()].map((d) => ({ id: d.id, title: d.title, version: d.version }));
  }

  getStatus(runId: string): RunRecord | null {
    const live = this.records.get(runId);
    if (live) return live;
    // After a process restart the in-memory record is gone, but the run's
    // per-step outputs live durably in the persisted snapshot's context. Rebuild
    // a lightweight record from it so the UI can still show each step's result
    // when a finished workflow card is reopened.
    return this.reconstructFromSnapshot(runId);
  }

  /** Rebuild a minimal RunRecord (status + per-step results) from a persisted snapshot. */
  private reconstructFromSnapshot(runId: string): RunRecord | null {
    const record = this.deps.store.load(runId);
    if (!record) return null;
    // Rebuild the dynamic def if the registry lacks it (post-restart) so the
    // reopened card shows the real title instead of the defId.
    this.ensureRegistered(record);
    const snapshot = record.snapshot;
    const results = this.extractStepResults(snapshot);
    const context = (snapshot as { context?: { finalResult?: unknown }; value?: unknown } | null)?.context;
    const finalResult =
      context && typeof context.finalResult === 'string' && context.finalResult.length > 0
        ? context.finalResult
        : undefined;
    const def = this.defs.get(record.defId);
    return {
      runId,
      defId: record.defId,
      version: record.version,
      title: def?.title ?? record.defId,
      status: record.status,
      currentState:
        typeof (snapshot as { value?: unknown } | null)?.value === 'string'
          ? (snapshot as { value: string }).value
          : '',
      trace: [],
      results,
      result: finalResult,
      startedAt: record.updatedAt,
      updatedAt: record.updatedAt,
    };
  }

  listRuns(): RunRecord[] {
    return [...this.records.values()];
  }

  /**
   * Abort a running workflow: stop its actor, mark the run failed, persist the
   * snapshot (with completed steps' outputs, so `retry` can continue from where
   * it stopped), and emit progress. The saved status is `failed`, so it is never
   * auto-rehydrated on restart (`listActive` only returns `running`) — it is
   * resumed only by an explicit `retry`. The in-flight `agent` step's background
   * poll self-terminates on its timeout.
   */
  abort(runId: string): boolean {
    const record = this.records.get(runId);
    if (!record || record.status !== 'running') return false;

    const now = Date.now();
    let abortedSnapshot: unknown = null;
    this.aborting.add(runId); // suppress the stop-triggered transition callback
    try {
      const actor = this.actors.get(runId);
      if (actor) {
        // Capture completed steps' outputs before stopping so a later retry can
        // skip them; the in-flight (incomplete) step has no result and re-runs.
        try {
          abortedSnapshot = actor.getPersistedSnapshot();
        } catch {
          abortedSnapshot = null;
        }
        actor.stop();
        this.actors.delete(runId);
      }
    } finally {
      this.aborting.delete(runId);
    }

    const last = record.trace[record.trace.length - 1];
    if (last && last.status === 'running') {
      last.status = 'failed';
      last.at = now;
    }
    record.status = 'failed';
    record.error = record.error ?? 'Aborted by user';
    record.updatedAt = now;

    const prev = this.deps.store.load(runId);
    this.deps.store.save({
      runId,
      defId: record.defId,
      version: record.version,
      status: 'failed',
      snapshot: abortedSnapshot,
      input: prev?.input ?? null,
      definition: this.dynamicDefs.get(record.defId) ?? prev?.definition,
      updatedAt: now,
    });

    this.emit('workflow:progress', { ...record, trace: [...record.trace] });
    return true;
  }

  /**
   * Forget a run entirely: abort it when still running, drop the in-memory
   * record, and delete its persisted snapshot so it can never rehydrate.
   * Used when the conversation that owns the run is deleted.
   */
  discardRun(runId: string): void {
    this.abort(runId); // no-op unless the run is still running
    this.records.delete(runId);
    this.deps.store.remove(runId);
  }

  /** Start a fresh run and return its id. */
  start(defId: string, input: unknown): string {
    const def = this.defs.get(defId);
    if (!def) {
      throw new Error(`Unknown workflow definition: ${defId}`);
    }
    const runId = randomUUID();
    // Inject the runId into the input so a dynamic workflow's context can derive
    // each node's deterministic child session key.
    const effectiveInput =
      input && typeof input === 'object' && !Array.isArray(input)
        ? { ...(input as Record<string, unknown>), runId }
        : input;
    this.spawn(def, runId, effectiveInput, undefined);
    return runId;
  }

  /**
   * Resume a persisted run from its snapshot. Refuses to rehydrate a snapshot
   * whose version no longer matches the current definition (the in-flight
   * migration trap) — such runs are quarantined as `failed`.
   */
  resume(runId: string): boolean {
    const record = this.deps.store.load(runId);
    if (!record) return false;
    this.ensureRegistered(record); // rebuild a dynamic def lost to a restart
    const def = this.defs.get(record.defId);
    if (!def) return false;
    if (record.version !== def.version) {
      this.quarantine(record, def, `definition version changed (${record.version} → ${def.version})`);
      return false;
    }
    if (record.status !== 'running') return false;
    this.spawn(def, runId, record.input, record.snapshot);
    return true;
  }

  /**
   * Continue a failed/aborted run from where it stopped. Reuses resume's
   * registration + version checks, but requires `status === 'failed'`: instead
   * of restoring the terminal snapshot (which would just sit in the `failed`
   * final state), it spawns a FRESH actor seeded with the completed steps'
   * outputs via `resumeResults`. The compiled machine's per-step `always` guard
   * then skips every step that already has a result, so only the interrupted
   * step (and everything after it) re-executes. The runId is reused so the chat
   * card continues in place; `startedAt` is bumped so the renderer allows the
   * failed→running reactivation past its monotonic guard.
   */
  async retry(runId: string): Promise<boolean> {
    const record = this.deps.store.load(runId);
    if (!record) return false;
    this.ensureRegistered(record); // rebuild a dynamic def lost to a restart
    const def = this.defs.get(record.defId);
    if (!def) return false;
    if (record.version !== def.version) {
      this.quarantine(record, def, `definition version changed (${record.version} → ${def.version})`);
      return false;
    }
    if (record.status !== 'failed') return false;

    // Discard the interrupted run's gateway sub-sessions BEFORE re-spawning. The
    // resume reuses the same runId (hence the same childSessionKey), so the old
    // sessions still hold the original run's messages — a dangling tool_use with
    // no/zero timestamp would leak past the reply waiter's startedAtMs filter and
    // pin its in-flight guard, stalling the resumed step to the 300s timeout.
    // Deleting them (history + residual run) makes each re-run step start clean.
    try {
      await this.deps.adapter.discardRunSessions?.(runId);
    } catch {
      // Best-effort — a failed cleanup must not block resume.
    }

    // Completed steps' outputs: prefer the persisted snapshot's context, fall
    // back to the in-memory record (both may exist depending on how it stopped).
    const resumeResults =
      this.extractStepResults(record.snapshot) ?? this.records.get(runId)?.results ?? {};

    const baseInput = record.input;
    const input =
      baseInput && typeof baseInput === 'object' && !Array.isArray(baseInput)
        ? { ...(baseInput as Record<string, unknown>), runId, resumeResults }
        : { runId, resumeResults };

    this.spawn(def, runId, input, undefined);
    return true;
  }

  /** On startup, rehydrate every run that was still running. */
  rehydrate(): void {
    for (const record of this.deps.store.listActive()) {
      try {
        this.resume(record.runId);
      } catch {
        // Never let one bad run block startup.
      }
    }
  }

  private quarantine(
    record: { runId: string; defId: string; input: unknown },
    def: WorkflowDefinition,
    reason: string,
  ): void {
    const now = Date.now();
    const run: RunRecord = {
      runId: record.runId,
      defId: record.defId,
      version: def.version,
      title: def.title,
      status: 'failed',
      currentState: 'quarantined',
      trace: [{ state: 'quarantined', status: 'failed', at: now }],
      error: `Run quarantined: ${reason}`,
      startedAt: now,
      updatedAt: now,
    };
    this.records.set(record.runId, run);
    this.deps.store.save({
      runId: record.runId,
      defId: record.defId,
      version: def.version,
      status: 'failed',
      snapshot: null,
      input: record.input,
      definition: (record as { definition?: DynamicWorkflowDefinition }).definition ?? this.dynamicDefs.get(record.defId),
      updatedAt: now,
    });
    this.emit('workflow:progress', run);
  }

  private spawn(
    def: WorkflowDefinition,
    runId: string,
    input: unknown,
    restoredSnapshot: unknown,
  ): void {
    const machine = def.createMachine(this.deps.adapter);
    const actor = createActor(machine, {
      input,
      snapshot: restoredSnapshot as SnapshotFrom<AnyStateMachine> | undefined,
    });

    const now = Date.now();
    const record: RunRecord = {
      runId,
      defId: def.id,
      version: def.version,
      title: def.title,
      status: 'running',
      currentState: '',
      trace: [],
      startedAt: now,
      updatedAt: now,
    };
    this.records.set(runId, record);

    actor.subscribe((snapshot) => {
      this.onTransition(def, runId, input, actor, snapshot);
    });

    this.actors.set(runId, actor);
    actor.start();
  }

  private onTransition(
    def: WorkflowDefinition,
    runId: string,
    input: unknown,
    actor: Actor<AnyStateMachine>,
    snapshot: SnapshotFrom<AnyStateMachine>,
  ): void {
    const record = this.records.get(runId);
    if (!record) return;
    // An abort in progress finalizes the record itself; ignore the transition
    // that `actor.stop()` triggers so it can't regress the status to running.
    if (this.aborting.has(runId)) return;

    const stateValue = stringifyState(snapshot.value);
    const stepKind: StepKind | undefined = def.stepKinds[stateValue];
    const status = this.toRunStatus(snapshot, stateValue);
    const now = Date.now();

    // Finalize the previous trace entry, append/replace the current one.
    this.updateTrace(record.trace, stateValue, stepKind, status, now);

    record.currentState = stateValue;
    record.currentStepKind = stepKind;
    record.status = status;
    record.updatedAt = now;
    if (status === 'failed') {
      record.error = this.extractError(snapshot) ?? record.error ?? 'Workflow failed';
    }
    if (status === 'done') {
      const result = this.extractResult(snapshot);
      if (result != null) record.result = result;
    }
    // Mirror the per-step outputs from the machine context so the UI can show
    // each step's result inline (and so they persist in the snapshot below).
    const stepResults = this.extractStepResults(snapshot);
    if (stepResults) record.results = stepResults;

    this.deps.store.save({
      runId,
      defId: def.id,
      version: def.version,
      status,
      snapshot: actor.getPersistedSnapshot(),
      input,
      definition: this.dynamicDefs.get(def.id),
      updatedAt: now,
    });

    this.emit('workflow:progress', { ...record, trace: [...record.trace] });

    if (status !== 'running') {
      actor.stop();
      this.actors.delete(runId);
    }
  }

  private updateTrace(
    trace: TraceEntry[],
    stateValue: string,
    stepKind: StepKind | undefined,
    status: RunStatus,
    now: number,
  ): void {
    const last = trace[trace.length - 1];
    if (last && last.state === stateValue) {
      last.status = status === 'failed' ? 'failed' : status === 'done' ? 'completed' : 'running';
      last.at = now;
      return;
    }
    if (last && last.status === 'running') {
      last.status = 'completed';
      last.at = now;
    }
    trace.push({
      state: stateValue,
      stepKind,
      status: status === 'failed' ? 'failed' : status === 'done' ? 'completed' : 'running',
      at: now,
    });
  }

  private toRunStatus(snapshot: SnapshotFrom<AnyStateMachine>, stateValue: string): RunStatus {
    if (snapshot.status === 'done') {
      return stateValue === FAILURE_STATE ? 'failed' : 'done';
    }
    if (snapshot.status === 'error') return 'failed';
    return 'running';
  }

  private extractError(snapshot: SnapshotFrom<AnyStateMachine>): string | undefined {
    const context = snapshot.context as { errorMessage?: unknown } | undefined;
    if (context && typeof context.errorMessage === 'string') return context.errorMessage;
    if (snapshot.error) return String(snapshot.error);
    return undefined;
  }

  /** The run's final synthesized result, if the machine's context exposes one. */
  private extractResult(snapshot: SnapshotFrom<AnyStateMachine>): string | undefined {
    const context = snapshot.context as { finalResult?: unknown } | undefined;
    if (context && typeof context.finalResult === 'string' && context.finalResult.length > 0) {
      return context.finalResult;
    }
    return undefined;
  }

  /**
   * Per-step outputs from the machine context (`results` map, keyed by stepId).
   * Accepts either a live XState snapshot or a persisted snapshot object, so it
   * works both on live transitions and when reconstructing from disk. Non-string
   * outputs (deterministic tools) are JSON-stringified for display.
   */
  private extractStepResults(snapshot: unknown): Record<string, string> | undefined {
    const context = (snapshot as { context?: { results?: Record<string, unknown> } } | undefined)?.context;
    const results = context?.results;
    if (!results || typeof results !== 'object') return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(results)) {
      if (value == null) continue;
      out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
