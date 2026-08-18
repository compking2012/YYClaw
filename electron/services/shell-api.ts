import { shell, clipboard } from 'electron';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { openAuthWindow as openAuthWindowImpl } from '../utils/auth-window';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

function expandShellPath(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith(`~${sep}`) || input.startsWith('~/') || input.startsWith('~\\')) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

function requirePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('path is required');
  }
  return path;
}

function requireUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('url is required');
  }
  return url;
}

export function createShellApi(): CompleteHostServiceRegistry['shell'] {
  return {
    openExternal: async (payload) => {
      await shell.openExternal(requireUrl(payload.url));
    },
    openAuthWindow: (payload) => {
      openAuthWindowImpl({
        url: requireUrl(payload.url),
        title: payload.title,
        intent: payload.intent,
      });
    },
    showItemInFolder: (payload) => {
      shell.showItemInFolder(expandShellPath(requirePath(payload.path)));
    },
    openPath: (payload) => shell.openPath(expandShellPath(requirePath(payload.path))),
    readClipboardText: () => clipboard.readText(),
  };
}
