import { app, utilityProcess } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';
import GATEWAY_FETCH_PRELOAD_SOURCE from './fetch-preload.js?raw';
import GATEWAY_ENTRY_WRAPPER_SOURCE from './gateway-entry-wrapper.cjs?raw';
import GATEWAY_ESM_REGISTER_SOURCE from './gateway-esm-register.cjs?raw';
import PROMPT_OPTIMIZATION_MERGE_SOURCE from './prompt-optimization-merge.cjs?raw';
import GATEWAY_FETCH_PRELOAD_GATES_SOURCE from './fetch-preload-gates.cjs?raw';
import GATEWAY_ESM_LOADER_SOURCE from './gateway-esm-loader.mjs?raw';

export function buildGatewayRuntimeEnv(
  forkEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...forkEnv,
    // ClawX does not expose LAN discovery, so keep Bonjour disabled even if
    // the parent process inherited an explicit opt-in value.
    OPENCLAW_DISABLE_BONJOUR: '1',
    // OpenClaw's built-in trace contains stage names and timings only. Keep it
    // enabled so packaged startup incidents are diagnosable from normal logs.
    OPENCLAW_GATEWAY_STARTUP_TRACE: '1',
    // Hard-restrict skill discovery to P1–P4 sources: managed, allowlisted
    // bundled skill-creator, extension/plugin-contributed skills. The bundled
    // kernel is patched (scripts/patch-skills-managed-only.mjs) to honour this
    // flag: skills in ~/.agents/skills, the workspace, extraDirs, etc. — even a
    // same-named one that would otherwise shadow the managed copy — are never
    // loaded. Per-agent agents.list[].skills allowlist +
    // skills.entries[].enabled still filter on top of this restricted set.
    CLAWX_SKILLS_MANAGED_ONLY: '1',
  };

  // Force a UTF-8 runtime for the forked gateway kernel and every child process
  // it spawns. Without this, on non-English Windows the process inherits the
  // system code page (e.g. Chinese CP936/GBK). Multi-byte CJK text then gets
  // encoded/decoded as GBK while single-byte ASCII is untouched — the exact
  // "Chinese-only, Windows-only" mojibake we saw persisted in openclaw.json,
  // whose display names the kernel re-writes on startup validation. The CLI
  // wrapper (resources/cli/win32/openclaw.cmd) already guards its own path with
  // `chcp 65001`; the GUI fork needs the equivalent. Only fill values that are
  // not already set so an explicit parent/user override still wins.
  const utf8Defaults: Record<string, string> = {
    // Robust switch for any Python descendant (uv-managed tools, etc.).
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  if (process.platform === 'win32') {
    // Normally unset on Windows; POSIX-style locale-sensitive libraries honour
    // these for text encoding. C.UTF-8 is a safe, locale-neutral UTF-8 value.
    utf8Defaults.LANG = 'C.UTF-8';
    utf8Defaults.LC_ALL = 'C.UTF-8';
    utf8Defaults.LC_CTYPE = 'C.UTF-8';
  }
  for (const [key, value] of Object.entries(utf8Defaults)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }

  return env;
}

function ensureGatewayFetchPreload(): string {
  const userDataDir = app.getPath('userData');
  const dest = path.join(userDataDir, 'gateway-fetch-preload.cjs');
  const mergeDest = path.join(userDataDir, 'prompt-optimization-merge.cjs');
  const gatesDest = path.join(userDataDir, 'fetch-preload-gates.cjs');
  const loaderDest = path.join(userDataDir, 'gateway-esm-loader.mjs');
  const registerDest = path.join(userDataDir, 'gateway-esm-register.cjs');
  try {
    writeFileSync(dest, GATEWAY_FETCH_PRELOAD_SOURCE, 'utf-8');
    writeFileSync(mergeDest, PROMPT_OPTIMIZATION_MERGE_SOURCE, 'utf-8');
    writeFileSync(gatesDest, GATEWAY_FETCH_PRELOAD_GATES_SOURCE, 'utf-8');
    writeFileSync(loaderDest, GATEWAY_ESM_LOADER_SOURCE, 'utf-8');
    writeFileSync(registerDest, GATEWAY_ESM_REGISTER_SOURCE, 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

function ensureGatewayEntryWrapper(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-entry-wrapper.cjs');
  try {
    writeFileSync(dest, GATEWAY_ENTRY_WRAPPER_SOURCE, 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

function shouldUseGatewayFetchPreload(appSettings: GatewayLaunchContext['appSettings']): boolean {
  return appSettings.promptOptimizationEnabled;
}

// Decode a piped child stream as UTF-8 and emit complete lines. A naive
// `data.toString()` per chunk splits both multi-byte UTF-8 sequences and lines
// at arbitrary buffer boundaries — on Windows pipes flush frequently, so CJK
// text intermittently corrupts into replacement characters. StringDecoder holds
// a trailing partial byte sequence until the rest of the character arrives; the
// line buffer holds a trailing partial line until its newline arrives.
function attachLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on('end', () => {
    buffer += decoder.end();
    if (buffer) {
      onLine(buffer);
      buffer = '';
    }
  });
}

export async function launchGatewayProcess(options: {
  port: number;
  launchContext: GatewayLaunchContext;
  sanitizeSpawnArgs: (args: string[]) => string[];
  getCurrentState: () => GatewayLifecycleState;
  getShouldReconnect: () => boolean;
  onStderrLine: (line: string) => void;
  onSpawn: (pid: number | undefined) => void;
  onExit: (child: Electron.UtilityProcess, code: number | null) => void;
  onError: (error: Error) => void;
}): Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }> {
  const {
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  } = options.launchContext;

  const openclawStreaming = '1';
  // buildGatewayRuntimeEnv() applies the mDNS/Bonjour disable and startup-trace
  // policy on top of forkEnv before any development-only augmentation below.
  const runtimeEnv = buildGatewayRuntimeEnv(forkEnv);
  const { appSettings } = options.launchContext;
  runtimeEnv.CLAWX_DEV_MODE_UNLOCKED = appSettings.devModeUnlocked ? '1' : '';
  runtimeEnv.CLAWX_PROMPT_OPTIMIZATION_ENABLED = appSettings.promptOptimizationEnabled ? '1' : '';
  runtimeEnv.CLAWX_OPENCLAW_DIR = openclawDir;

  // Dev: fork openclaw.mjs directly; preload + ESM register via NODE_OPTIONS --require.
  // Packaged: UtilityProcess rejects NODE_OPTIONS; use wrapper with module.register().
  let forkEntryScript = entryScript;
  const needsFetchPreload = shouldUseGatewayFetchPreload(appSettings);
  try {
    const preloadPath = ensureGatewayFetchPreload();
    if (!existsSync(preloadPath)) {
      // preload files not written
    } else if (needsFetchPreload && !app.isPackaged) {
      const registerPath = path.join(app.getPath('userData'), 'gateway-esm-register.cjs');
      if (existsSync(registerPath)) {
        runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
          runtimeEnv.NODE_OPTIONS,
          registerPath,
        );
      }
      runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
        runtimeEnv.NODE_OPTIONS,
        preloadPath,
      );
    } else if (needsFetchPreload) {
      const wrapperPath = ensureGatewayEntryWrapper();
      if (existsSync(wrapperPath)) {
        runtimeEnv.CLAWX_OPENCLAW_ENTRY = entryScript;
        forkEntryScript = wrapperPath;
      }
    }
  } catch (err) {
    logger.warn('Failed to set up gateway fetch preload:', err);
  }

  logger.info(
    `Starting Gateway process (mode=${mode}, port=${options.port}, entry="${forkEntryScript}", openclaw="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount}, channels=${channelStartupSummary}, proxy=${proxySummary}, fetchPreload=${forkEntryScript !== entryScript ? 'wrapper' : 'off'}, openclawStreaming=${openclawStreaming})`,
  );
  const lastSpawnSummary = `mode=${mode}, entry="${forkEntryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}"`;

  return await new Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }>((resolve, reject) => {
    const child = utilityProcess.fork(forkEntryScript, gatewayArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: runtimeEnv as NodeJS.ProcessEnv,
      serviceName: 'OpenClaw Gateway',
    });

    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve({ child, lastSpawnSummary });
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('Gateway process spawn error:', error);
      options.onError(normalizedError);
      rejectOnce(normalizedError);
    });

    child.on('exit', (code: number) => {
      // Only check shouldReconnect — not current state.  On Windows the WS
      // close handler fires before the process exit handler and sets state to
      // 'stopped', which would make an unexpected crash look like a planned
      // shutdown in logs.  shouldReconnect is the reliable indicator: stop()
      // sets it to false (expected), crashes leave it true (unexpected).
      const expectedExit = !options.getShouldReconnect();
      const level = expectedExit ? logger.info : logger.warn;
      level(`Gateway process exited (code=${code}, expected=${expectedExit ? 'yes' : 'no'})`);
      options.onExit(child, code);
    });

    if (child.stderr) {
      attachLineReader(child.stderr, options.onStderrLine);
    }

    if (child.stdout) {
      attachLineReader(child.stdout, (line) => {
        if (line.trim()) {
          logger.debug(`[Gateway stdout] ${line}`);
        }
      });
    }

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}
