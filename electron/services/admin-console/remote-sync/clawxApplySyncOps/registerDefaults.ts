import { applyModelsCreateProvider } from '../apply-models-create-provider';
import { applyModelsDeleteProvider } from '../apply-models-delete-provider';
import { applyModelsSetDefaultPrimary } from '../apply-models-set-default-primary';
import { applyGatewayRestart } from '../apply-gateway-restart';
import { applySkillsSetEnabled } from '../apply-skills-set-enabled';
import { applySkillsUpdateConfig } from '../apply-skills-update-config';
import { applyAgentsCreate } from '../apply-agents-create';
import { applyAgentsDelete } from '../apply-agents-delete';
import { applyAgentsSetDefault } from '../apply-agents-set-default';
import { applyAgentsSetModel } from '../apply-agents-set-model';
import { applyAgentsUpdateProfile } from '../apply-agents-update-profile';
import { applyAgentsSetTools } from '../apply-agents-set-tools';
import { ClawxApplySyncOp } from './ops';
import { registerClawxApplySyncOp } from './registry';

function registerDefaults(): void {
  registerClawxApplySyncOp(ClawxApplySyncOp.modelsCreateProvider, (gateway, payload) =>
    applyModelsCreateProvider(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.modelsDeleteProvider, (gateway, payload) =>
    applyModelsDeleteProvider(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.modelsSetDefaultPrimary, (gateway, payload) =>
    applyModelsSetDefaultPrimary(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.gatewayRestart, (gateway, payload) =>
    applyGatewayRestart(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.skillsSetEnabled, (gateway, payload) =>
    applySkillsSetEnabled(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.skillsUpdateConfig, (gateway, payload) =>
    applySkillsUpdateConfig(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsCreate, (gateway, payload) =>
    applyAgentsCreate(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsDelete, (gateway, payload) =>
    applyAgentsDelete(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsSetDefault, (gateway, payload) =>
    applyAgentsSetDefault(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsSetModel, (gateway, payload) =>
    applyAgentsSetModel(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsUpdateProfile, (gateway, payload) =>
    applyAgentsUpdateProfile(gateway, payload),
  );
  registerClawxApplySyncOp(ClawxApplySyncOp.agentsSetTools, (gateway, payload) =>
    applyAgentsSetTools(gateway, payload),
  );
}

registerDefaults();
