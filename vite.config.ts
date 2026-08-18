import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import {
  MAIN_PROCESS_BUNDLED_ROOT_PACKAGES,
  collectBundledPackageGraph,
  isBundledMainProcessImport,
} from './scripts/electron-main-bundled-packages.mjs';
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

function getExtensionPackages(): Set<string> {
  try {
    const manifestPath = resolve(__dirname, 'clawx-extensions.json');
    if (!existsSync(manifestPath)) return new Set();
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const allIds: string[] = [
      ...(manifest.extensions?.main ?? []),
      ...(manifest.extensions?.renderer ?? []),
    ];
    const pkgs = new Set<string>();
    for (const id of allIds) {
      if (id.startsWith('builtin/')) continue;
      const parts = id.split('/');
      pkgs.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
    return pkgs;
  } catch {
    return new Set();
  }
}

function dropLangGraphOutputWhenDisabled(enabled: boolean) {
  return {
    name: 'drop-langgraph-output-when-disabled',
    generateBundle(_options: unknown, bundle: Record<string, { type?: string; code?: string }>) {
      if (enabled) return;
      for (const [fileName, output] of Object.entries(bundle)) {
        const isLangGraphArtifact =
          /langgraph|langchain/i.test(fileName)
          || (output.type === 'chunk' && output.code?.includes('@langchain'));
        if (isLangGraphArtifact) {
          delete bundle[fileName];
        }
      }
    },
  };
}

const alias = {
  '@': resolve(__dirname, 'src'),
  '@electron': resolve(__dirname, 'electron'),
  '@shared': resolve(__dirname, 'shared'),
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  loadLangGraphEnvFiles(mode);
  loadOfficeEnvFiles(mode);
  loadOfficeUserCheckpointEnv(mode);
  const enableLangGraph = isLangGraphCompileEnabled();
  const showOfficeCollaboration = isOfficeCollaborationConfigurable();
  const showOfficeSessions = isOfficeSessionsVisible();
  const enableUserCheckpoint = isOfficeUserCheckpointEnabled();
  const extensionPackages = getExtensionPackages();
  const mainProcessBundledPackages = enableLangGraph
    ? collectBundledPackageGraph(__dirname, MAIN_PROCESS_BUNDLED_ROOT_PACKAGES)
    : new Set<string>();

  function isMainProcessExternal(id: string): boolean {
    if (!id || id.startsWith('\0')) return false;
    if (id.startsWith('.') || id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id)) return false;
    if (id.startsWith('@/') || id.startsWith('@electron/') || id.startsWith('@shared/')) return false;
    if (isBundledMainProcessImport(id, mainProcessBundledPackages)) return false;
    for (const pkg of extensionPackages) {
      if (id === pkg || id.startsWith(pkg + '/')) return false;
    }
    return true;
  }

  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
  const openclawVersion = (pkg.devDependencies?.openclaw ?? '') as string;

  const compileTimeDefine = {
    __ENABLE_LANGGRAPH__: enableLangGraph,
    __SHOW_OFFICE_COLLABORATION__: showOfficeCollaboration,
    __OPENCLAW_VERSION__: JSON.stringify(openclawVersion),
    __SHOW_OFFICE_SESSIONS__: showOfficeSessions,
    __OFFICE_USER_CHECKPOINT__: enableUserCheckpoint,
  };

  return {
    // Required for Electron: all asset URLs must be relative because the renderer
    // loads via file:// in production. vite-plugin-electron-renderer sets this
    // automatically, but we declare it explicitly so the intent is clear and the
    // build remains correct even if plugin order ever changes.
    base: './',
    define: compileTimeDefine,
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main/index.ts',
          onstart(options) {
            options.startup(
              process.env.CLAWX_DEBUG_PORT
                ? ['.', `--remote-debugging-port=${process.env.CLAWX_DEBUG_PORT}`]
                : ['.'],
            );
          },
          vite: {
            define: compileTimeDefine,
            plugins: [dropLangGraphOutputWhenDisabled(enableLangGraph)],
            resolve: {
              alias,
            },
            build: {
              outDir: 'dist-electron/main',
              emptyOutDir: true,
              rollupOptions: {
                external: (id) => {
                  const customExternals = ['electron-store', 'electron-updater', 'ws', 'posthog-node', 'node-machine-id'];
                  if (customExternals.includes(id)) return true;
                  return isMainProcessExternal(id);
                },
              },
            },
          },
        },
        {
          entry: 'electron/preload/index.ts',
          onstart(options) {
            options.reload();
          },
          vite: {
            define: compileTimeDefine,
            resolve: {
              alias,
            },
            build: {
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      renderer(),
    ],
    resolve: {
      alias,
      dedupe: ['react', 'react-dom', 'react-i18next', 'zustand', 'sonner', 'lucide-react'],
    },
    server: {
      port: 5173,
      watch: {
        // electron-builder wine cache symlinks z: -> /; without ignore, dev scans the whole OS.
        ignored: ['**/resources/build-cache/**', '**/release/**'],
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
