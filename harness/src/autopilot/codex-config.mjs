import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';

const modelSettings = [
  'model', 'model_provider', 'model_reasoning_effort', 'model_reasoning_summary',
  'model_verbosity', 'model_context_window', 'model_auto_compact_token_limit',
  'model_supports_reasoning_summaries', 'service_tier', 'preferred_auth_method',
  'forced_login_method', 'forced_chatgpt_workspace_id', 'chatgpt_base_url',
];
const providerSettings = [
  'name', 'base_url', 'wire_api', 'env_key', 'env_key_instructions',
  'requires_openai_auth', 'experimental_bearer_token', 'http_headers',
  'env_http_headers', 'query_params', 'request_max_retries', 'stream_max_retries',
  'stream_idle_timeout_ms', 'supports_websockets', 'websocket_connect_timeout_ms',
];
const networkVariables = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
];
const forbiddenVariables = /^(?:GH_|GITHUB_|GIT_|GITLAB_|SSH_|AWS_|AZURE_|GOOGLE_|NPM_|PNPM_|CODEX_|AUTOPILOT_)|^(?:HOME|USERPROFILE|XDG_CONFIG_HOME|APPDATA|LOCALAPPDATA|TMPDIR|TEMP|TMP|PATH|NODE_OPTIONS|LD_PRELOAD|DYLD_.*|BASH_ENV|ENV|CI)$/i;

async function optionalFile(file) {
  try { return await readFile(file); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function select(source, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}

export async function loadCodexConnection(authHome, environment = process.env) {
  const source = await optionalFile(path.join(authHome, 'config.toml'));
  let settings = {};
  if (source) {
    try { settings = parse(source.toString('utf8')); }
    catch { throw new Error('Invalid local Codex config.toml; fix its TOML syntax before running Autopilot'); }
  }
  if (settings.profile !== undefined) {
    if (typeof settings.profile !== 'string' || !settings.profiles?.[settings.profile]) throw new Error('The selected local Codex profile is missing');
    settings = { ...settings, ...settings.profiles[settings.profile] };
  }
  const config = select(settings, modelSettings);
  const providerId = config.model_provider ?? 'openai';
  if (typeof providerId !== 'string' || !providerId) throw new Error('Local Codex model_provider must be a non-empty string');
  const sourceProvider = settings.model_providers?.[providerId];
  if (!sourceProvider && !['openai', 'ollama', 'lmstudio'].includes(providerId)) throw new Error('The selected local Codex model provider is missing from model_providers');
  if (sourceProvider && (typeof sourceProvider !== 'object' || Array.isArray(sourceProvider))) throw new Error('Invalid local Codex model provider configuration');
  const provider = select(sourceProvider ?? {}, providerSettings);
  if (sourceProvider) config.model_providers = { [providerId]: provider };
  const env = select(environment, networkVariables);
  const inherit = (name, required) => {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || forbiddenVariables.test(name)) throw new Error('Codex provider references an unsafe environment variable; publishing and execution-control credentials cannot be inherited');
    if (required && !environment[name]) throw new Error(`Local Codex provider requires environment variable ${name}; export it before running Autopilot`);
    if (environment[name] !== undefined) env[name] = environment[name];
  };
  if (providerId === 'openai' || provider.requires_openai_auth) {
    inherit('OPENAI_API_KEY', false);
    inherit('OPENAI_BASE_URL', false);
    inherit('OPENAI_ORGANIZATION', false);
    inherit('OPENAI_PROJECT', false);
  }
  if (provider.env_key !== undefined) inherit(provider.env_key, true);
  if (provider.env_http_headers !== undefined) {
    if (!provider.env_http_headers || typeof provider.env_http_headers !== 'object' || Array.isArray(provider.env_http_headers)) throw new Error('Invalid local Codex provider env_http_headers');
    for (const name of Object.values(provider.env_http_headers)) inherit(name, false);
  }
  const auth = await optionalFile(path.join(authHome, 'auth.json'));
  const needsAuth = providerId === 'openai' || provider.requires_openai_auth === true;
  if (needsAuth && !auth && !env.OPENAI_API_KEY && !provider.experimental_bearer_token && !provider.env_key) throw new Error('Local Codex authentication is unavailable; sign in with Codex or export the configured provider API key');
  return { config, env, auth };
}

export async function prepareCodexConnection(authHome, codexHome) {
  const connection = await loadCodexConnection(authHome);
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await chmod(codexHome, 0o700);
  const configFile = path.join(codexHome, 'config.toml');
  await writeFile(configFile, stringify(connection.config), { mode: 0o600 });
  await chmod(configFile, 0o600);
  const authFile = path.join(codexHome, 'auth.json');
  if (connection.auth) {
    await writeFile(authFile, connection.auth, { mode: 0o600 });
    await chmod(authFile, 0o600);
  } else await rm(authFile, { force: true });
  return connection.env;
}
