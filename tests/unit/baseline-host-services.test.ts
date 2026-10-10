import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';
import { createAppApi } from '@electron/services/app-api';
import { createGatewayApi } from '@electron/services/gateway-api';

const { credentials, login } = vi.hoisted(() => ({
  credentials: vi.fn(() => ({ appId: 'app-id', appSecret: 'private-secret' })),
  login: vi.fn(),
}));

vi.mock('@electron/utils/feishu-oauth', () => ({
  getFeishuAppCredentials: credentials,
  handleFeishuLogin: login,
}));

describe('baseline host services', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only public Feishu configuration and validates login input', async () => {
    const api = createAppApi();
    expect(api.feishuConfig()).toEqual({ appId: 'app-id' });
    login.mockResolvedValue({ success: true, userInfo: { name: 'Tester', open_id: 'user-id' } });
    await expect(api.feishuLogin({ tmpCode: 'temporary-code' })).resolves.toMatchObject({
      success: true, userInfo: { name: 'Tester' },
    });
    expect(login).toHaveBeenCalledWith('temporary-code');
    await expect(api.feishuLogin({ tmpCode: ' ' })).rejects.toThrow('Invalid Feishu login code');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('delegates quitting to the Main process', () => {
    createAppApi().quit();
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit force-kill consent through the gateway manager', () => {
    const conflict = { port: 18789, externalPids: ['123'] };
    const manager = {
      getPendingPortConflict: vi.fn(() => conflict),
      resolvePortConflict: vi.fn(),
    };
    const api = createGatewayApi(manager as never);
    expect(api.pendingPortConflict()).toEqual(conflict);
    api.resolvePortConflict({ forceKill: true });
    api.resolvePortConflict({ forceKill: false });
    expect(manager.resolvePortConflict.mock.calls).toEqual([[true], [false]]);
    expect(() => api.resolvePortConflict({ forceKill: 'true' } as never))
      .toThrow('Invalid port conflict resolution');
    expect(manager.resolvePortConflict).toHaveBeenCalledTimes(2);
  });
});
