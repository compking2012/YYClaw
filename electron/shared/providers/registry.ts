import * as fs from 'fs';
import * as path from 'path';
import { getResourcesDir } from '../../utils/paths';
import type {
  ProviderBackendConfig,
  ProviderDefinition,
  ProviderType,
  ProviderTypeInfo,
} from './types';

const configPath = path.join(getResourcesDir(), 'config', 'providers.json');
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = JSON.parse(
  fs.readFileSync(configPath, 'utf8')
).map((def: any) => {
  def.isOAuth = def.supportedAuthModes?.some((m: string) => m.startsWith('oauth')) ?? false;
  def.supportsApiKey = def.supportedAuthModes?.includes('api_key') ?? false;
  return def;
});

const PROVIDER_DEFINITION_MAP = new Map(
  PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getProviderDefinition(
  type: ProviderType | string,
): ProviderDefinition | undefined {
  return PROVIDER_DEFINITION_MAP.get(type as ProviderType);
}

export function getProviderTypeInfo(
  type: ProviderType,
): ProviderTypeInfo | undefined {
  return getProviderDefinition(type);
}

export function getProviderEnvVar(type: string): string | undefined {
  return getProviderDefinition(type)?.envVar;
}

export function getProviderDefaultModel(type: string): string | string[] | undefined {
  return getProviderDefinition(type)?.defaultModelId;
}

export function getProviderBackendConfig(
  type: string,
): ProviderBackendConfig | undefined {
  const def = getProviderDefinition(type);
  if (!def) return undefined;

  if (def.apiProtocol) {
    return {
      baseUrl: def.defaultBaseUrl || '',
      api: def.apiProtocol,
      apiKeyEnv: def.envVar || '',
      headers: def.headers,
      models: def.backendModels,
    };
  }
  return def.providerConfig;
}

export function getProviderUiInfoList(): ProviderTypeInfo[] {
  return PROVIDER_DEFINITIONS;
}

export function getKeyableProviderTypes(): string[] {
  return PROVIDER_DEFINITIONS.filter((definition) => definition.envVar).map(
    (definition) => definition.id,
  );
}
