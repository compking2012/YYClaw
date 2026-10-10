import { app } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { readSessionMaintenance, saveSessionMaintenance, readControlUiEnabled, setControlUiEnabled, readOpenClawVersion } from '../utils/channel-config';
import { isRecord } from './payload-utils';
import { getFeishuAppCredentials, handleFeishuLogin } from '../utils/feishu-oauth';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(): CompleteHostServiceRegistry['app'] {
  return {
    quit: () => app.quit(),
    feishuConfig: () => ({ appId: getFeishuAppCredentials().appId }),
    feishuLogin: async (payload) => {
      if (!isRecord(payload) || typeof payload.tmpCode !== 'string' || !payload.tmpCode.trim()) {
        throw new Error('Invalid Feishu login code');
      }
      const result = await handleFeishuLogin(payload.tmpCode);
      return {
        ...result,
        userInfo: result.userInfo ? { ...result.userInfo } : undefined,
      };
    },
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      return body.mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
    },
    sessionMaintenance: async () => readSessionMaintenance(),
    saveSessionMaintenance: async (payload) => {
      const patch = isRecord(payload) ? payload : {};
      return saveSessionMaintenance(patch);
    },
    controlUiEnabled: async () => readControlUiEnabled(),
    setControlUiEnabled: async (payload) => {
      const enabled = isRecord(payload) ? Boolean(payload.enabled) : Boolean(payload);
      return setControlUiEnabled(enabled);
    },
    openclawVersion: async () => readOpenClawVersion(),
  };
}
