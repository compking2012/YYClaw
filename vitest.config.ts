import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import {
  isLangGraphCompileEnabled,
  loadLangGraphEnvFiles,
} from './scripts/is-langgraph-enabled.mjs';
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

export default defineConfig({
  define: {
    __ENABLE_LANGGRAPH__: enableLangGraph,
    __SHOW_OFFICE_COLLABORATION__: showOfficeCollaboration,
    __SHOW_OFFICE_SESSIONS__: showOfficeSessions,
    __OFFICE_USER_CHECKPOINT__: enableUserCheckpoint,
  },
  plugins: [
    react(),
    {
      // Node 22 的 node:sqlite 仍是 experimental，不在 builtinModules 列表里，
      // Vite 不会自动 external，jsdom(client) 环境的 noExternal 下会试图打包而报错。
      // 在此显式标记为 external，运行时由 Node 原生 import 承接。
      name: 'externalize-node-sqlite',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'node:sqlite') {
          return { id, external: true };
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
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
