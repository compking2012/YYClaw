import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { readSessionMaintenance, saveSessionMaintenance, readControlUiEnabled, setControlUiEnabled, readOpenClawVersion } from '../utils/channel-config';
import { isRecord } from './payload-utils';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(): CompleteHostServiceRegistry['app'] {
  return {
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
