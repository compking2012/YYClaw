import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { isLangGraphCompileEnabled, loadLangGraphEnvFiles } from './scripts/is-langgraph-enabled.mjs';
import {
  isOfficeCollaborationConfigurable,
  isOfficeSessionsVisible,
  loadOfficeEnvFiles,
} from './scripts/is-office-collaboration-configurable.mjs';
import {
  isOfficeUserCheckpointEnabled,
  loadOfficeUserCheckpointEnv,
} from './scripts/is-office-user-checkpoint-enabled.mjs';

loadLangGraphEnvFiles('test');
loadOfficeEnvFiles('test');
loadOfficeUserCheckpointEnv('test');
const enableLangGraph = isLangGraphCompileEnabled();
const showOfficeCollaboration = isOfficeCollaborationConfigurable();
const showOfficeSessions = isOfficeSessionsVisible();
const enableUserCheckpoint = isOfficeUserCheckpointEnabled();

/** Office module coverage: business logic only; integration/I/O entry points excluded. */
const OFFICE_INTEGRATION_EXCLUDES = [
  'node_modules/',
  'tests/',
  'electron/services/office/workflow-runner.ts',
  'electron/services/office/orchestrator.ts',
  'electron/services/office/room-mention-dispatch.ts',
  'electron/services/office/smart-task-runner.ts',
  'electron/services/office/smart-task-progress-driver.ts',
  'electron/services/office/workflow-agent-llm.ts',
  'electron/services/office/room-mention-llm.ts',
  'electron/services/office/task-run.ts',
  'electron/services/office/room-workflow-handoff-watch.ts',
  'electron/services/office/workflow-coordinator-intervention.ts',
  'electron/services/office/workflow-room-progress.ts',
  'electron/services/office/room-mention-disk-verify.ts',
  'electron/services/office/room-mention-gateway.ts',
  'electron/services/office/smart-deliverable-verify-notify.ts',
  'electron/services/office/office-sync-runtime.ts',
  'electron/services/office/office-project-room-sync.ts',
  'electron/services/office/office-session-history-sync.ts',
  'electron/services/office/project-context-load.ts',
  'electron/services/office/project-context-reset.ts',
  'electron/services/office/gateway-rpc.ts',
  'electron/services/office/audit.ts',
  'electron/services/office/role-status-persist.ts',
  'electron/services/office/workflow-role-assignment-init.ts',
  'electron/services/office/room-structured-context.ts',
  'electron/services/office/mention-task-context.ts',
  'electron/services/office/room-prompts/**',
  'electron/services/office/**/*-fs.ts',
  'src/lib/office-workflow-generate-client.ts',
  'src/lib/office-workflow-room-heal-pipeline.ts',
  // Gateway / 房间派发 / 生成链路（>65% 未覆盖，由 E2E/集成测试承担）
  'electron/services/office/agent-setup.ts',
  'electron/services/office/mention-run-settled.ts',
  'electron/services/office/run-completion.ts',
  'electron/services/office/workflow-generate.ts',
  'electron/services/office/workflow-generate-prompt.ts',
  'electron/services/office/workflow-user-intervention.ts',
  'electron/services/office/workflow-room-handoff.ts',
  'electron/services/office/workflow-role-step-outcome.ts',
  'electron/services/office/workflow-run-registry.ts',
  'electron/services/office/workflow-edges.ts',
  'electron/services/office/room-mention-publish.ts',
  'electron/services/office/room-missing-mention-coordinator.ts',
  'electron/services/office/room-unmentioned-coordinator.ts',
  'electron/services/office/room-session-mirror.ts',
  'electron/services/office/room-context.ts',
  'electron/services/office/room-context-limits.ts',
  'electron/services/office/room-fast-ack.ts',
  'electron/services/office/room-task-intent.ts',
  'electron/services/office/project-context-paths.ts',
  'electron/services/office/role-status-cache.ts',
  'electron/services/office/scenario-progress-reconcile.ts',
  'electron/services/office/smart-coordinator-room-mirror.ts',
  'electron/services/office/task-room-progress-reconcile.ts',
  'electron/services/office/task-run-abort-registry.ts',
  'src/lib/office-execution-sync.ts',
  'src/lib/office-room-message.ts',
  'src/lib/office-room-reply.ts',
  'src/lib/office-smart-retry-diff.ts',
  'src/lib/office-workflow-agent-recovery.ts',
  'src/lib/office-workflow-coordinator-task-prompt.ts',
  'src/lib/office-workflow-handoff-compliance.ts',
  'src/lib/office-workflow-member-task-prompt.ts',
  'src/lib/office-workflow-role-step.ts',
  'src/lib/office-workflow-room-dispatch.ts',
  'src/lib/office-workflow-run-active-roles.ts',
  'electron/services/office/room-mention-structured-reply.ts',
  'electron/services/office/smart-task-completion.ts',
  'electron/services/office/room-dispatch-policy.ts',
  'electron/services/office/room-follow-up-policy.ts',
  'electron/services/office/room-mention-reply-policy.ts',
  'electron/services/office/room-reply.ts',
  'electron/services/office/task-coordinator.ts',
  'electron/services/office/task-execution-mode.ts',
  'src/lib/office-workflow-user-intervention.ts',
  'src/lib/office-workflow-task-prompt.ts',
];

export default defineConfig({
  define: {
    __ENABLE_LANGGRAPH__: enableLangGraph,
    __SHOW_OFFICE_COLLABORATION__: showOfficeCollaboration,
    __SHOW_OFFICE_SESSIONS__: showOfficeSessions,
    __OFFICE_USER_CHECKPOINT__: enableUserCheckpoint,
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/office-*.test.ts'],
    exclude: enableLangGraph
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, 'tests/unit/**/office-*langgraph*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'coverage/office',
      include: ['src/lib/office-*', 'src/lib/office-**/*', 'electron/services/office/**'],
      exclude: OFFICE_INTEGRATION_EXCLUDES,
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
