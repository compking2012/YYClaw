import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  utilityProcess: {},
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: vi.fn(),
  spawn: vi.fn(),
  default: {
    exec: mockExec,
    execSync: vi.fn(),
    spawn: vi.fn(),
  },
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
  kill = vi.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('ws', () => {
  return {
    default: class MockWebSocket {
      constructor() {
        setTimeout(() => this.onerror?.(), 0);
      }
      on(event: string, callback: () => void) {
        if (event === 'error') this.onerror = callback;
      }
      terminate() {}
      onerror?: () => void;
    }
  };
});

describe('gateway supervisor process cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy for owned process on Windows', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    // Mock getProcessTreeIds response by mocking exec
    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('wmic process get processid,parentprocessid')) {
        cb(null, 'ParentProcessId  ProcessId\n 4000  4321\n 4321  4322\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    
    // We need to wait a tick for the async getProcessTreeIds to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith(
        'taskkill /F /PID 4321 /T',
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
        expect.any(Function),
      );
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses direct child.kill for owned process on non-Windows', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    // Mock getProcessTreeIds response by mocking exec
    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('ps -ax -o ppid= -o pid=')) {
        cb(null, ' 1000  9876\n 9876  9877\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    
    // We need to wait a tick for the async getProcessTreeIds to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    
    child.emit('exit', 0);
    await stopPromise;

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('throws PortConflictError when external process is using port', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess, forceKillGatewayProcesses } = await import('@electron/gateway/supervisor');
    const { PortConflictError } = await import('@electron/gateway/startup-orchestrator');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    await expect(findExistingGatewayProcess({ port: 18789 })).rejects.toThrow(PortConflictError);

    // Test the cleanup function separately
    await forceKillGatewayProcesses(18789, ['4321']);

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /PID 4321 /T'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
  });

  it('ignores child processes of ownedPid when checking for port conflict', async () => {
    setPlatform('linux');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('lsof -i')) {
        // Child process 1002 is listening on the port
        cb(null, '1002\n');
        return {} as never;
      }
      if (cmd.includes('ps -ax -o ppid= -o pid=')) {
        // 1001 is the parent of 1002
        cb(null, ' 1000  1001\n 1001  1002\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    // ownedPid is 1001. The port is bound by 1002, which is a child of 1001.
    // It should not throw a conflict error, but rather return null since the WebSocket probe will fail (mocked out to false).
    const result = await findExistingGatewayProcess({ port: 18789, ownedPid: 1001 });
    expect(result).toBeNull();
  });

  it('ignores child processes of ownedPid on Windows when checking for port conflict', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    5002\n');
        return {} as never;
      }
      if (cmd.includes('wmic process get processid,parentprocessid')) {
        cb(null, 'ParentProcessId  ProcessId\n 5000  5001\n 5001  5002\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    // ownedPid is 5001. The port is bound by 5002, which is a child of 5001.
    const result = await findExistingGatewayProcess({ port: 18789, ownedPid: 5001 });
    expect(result).toBeNull();
  });
});
