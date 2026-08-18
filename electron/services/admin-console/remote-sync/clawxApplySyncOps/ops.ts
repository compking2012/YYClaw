// @ts-nocheck
/** Align with YYClawManager syncops / frontend ClawxSyncOp. */
export const ClawxApplySyncOp = {
  modelsCreateProvider: 'models_create_provider',
  modelsDeleteProvider: 'models_delete_provider',
  modelsSetDefaultPrimary: 'models_set_default_primary',
  gatewayRestart: 'gateway_restart',
  skillsSetEnabled: 'skills_set_enabled',
  skillsUpdateConfig: 'skills_update_config',
  agentsCreate: 'agents_create',
  agentsDelete: 'agents_delete',
  agentsSetDefault: 'agents_set_default',
  agentsSetModel: 'agents_set_model',
  agentsUpdateProfile: 'agents_update_profile',
  agentsSetTools: 'agents_set_tools',
} as const;
