#!/usr/bin/env node
/**
 * Extended mac arm64 CI smoke: wait for Main-process provider setup (CLAWX_CI_SMOKE),
 * verify gateway reload, send a chat message, validate the assistant reply mentions today's date.
 */
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';

const GATEWAY_PROTOCOL_VERSION = 4;

const APP_SUPPORT = join(homedir(), 'Library/Application Support/YYClaw');
const CI_SMOKE_READY_FILE = 'ci-smoke-ready';
const CI_SMOKE_FAILED_FILE = 'ci-smoke-failed';
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT || 18789);
const GATEWAY_MAX_WAIT_SEC = Number(process.env.SMOKE_GATEWAY_MAX_WAIT_SEC || process.env.SMOKE_GATEWAY_WAIT_SEC || 45);
const GATEWAY_POLL_INTERVAL_SEC = Number(process.env.SMOKE_GATEWAY_POLL_INTERVAL_SEC || 3);
const GATEWAY_PROBE_TIMEOUT_MS = Number(process.env.SMOKE_GATEWAY_PROBE_TIMEOUT_MS || 2000);
const CHAT_WAIT_SEC = Number(process.env.SMOKE_CHAT_WAIT_SEC || 300);
const CHAT_POLL_INTERVAL_SEC = Number(process.env.SMOKE_CHAT_POLL_INTERVAL_SEC || 10);

const CHAT_MESSAGE =
  process.env.SMOKE_CHAT_MESSAGE ||
  '你好，今天的日期是？请以中文格式xxx年xxx月xxx日回答';
const TIMEZONE = process.env.SMOKE_CHAT_TIMEZONE || 'Asia/Shanghai';
const CONNECT_SCOPES = ['operator.admin', 'operator.read', 'operator.write'];
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function log(message) {
  const ts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(' ', ' ');
  console.log(`[mac-arm64-smoke-e2e ${ts} +0800] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function waitForCiSmokeReady(maxSec = 120) {
  const readyPath = join(APP_SUPPORT, CI_SMOKE_READY_FILE);
  const failedPath = join(APP_SUPPORT, CI_SMOKE_FAILED_FILE);
  log(`waiting for CI smoke provider setup marker: ${readyPath}`);
  for (let i = 0; i < maxSec; i += 1) {
    if (existsSync(failedPath)) {
      const reason = readFileSync(failedPath, 'utf8').trim();
      throw new Error(`CI smoke provider setup failed in app: ${reason || '(no details)'}`);
    }
    if (existsSync(readyPath)) {
      log('CI smoke provider setup ready');
      return;
    }
    await sleep(1000);
  }
  throw new Error(
    `CI smoke ready marker not found within ${maxSec}s `
    + '(is CLAWX_CI_SMOKE=1 set on app launch with SMOKE_GLM_API_KEY?)',
  );
}

function readGatewayToken() {
  const settingsPath = join(APP_SUPPORT, 'settings.json');
  if (!existsSync(settingsPath)) {
    throw new Error(`settings.json not found: ${settingsPath}`);
  }
  const token = readJson(settingsPath).gatewayToken;
  if (!token) {
    throw new Error('gatewayToken missing in settings.json');
  }
  return token;
}

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32
    && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function buildDeviceAuthPayload(params) {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function loadDeviceIdentity() {
  const identityPath = join(APP_SUPPORT, 'clawx-device-identity.json');
  if (!existsSync(identityPath)) {
    throw new Error(`device identity not found: ${identityPath}`);
  }
  const parsed = readJson(identityPath);
  if (
    parsed?.version !== 1
    || typeof parsed.deviceId !== 'string'
    || typeof parsed.publicKeyPem !== 'string'
    || typeof parsed.privateKeyPem !== 'string'
  ) {
    throw new Error(`invalid device identity file: ${identityPath}`);
  }
  return {
    deviceId: parsed.deviceId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
  };
}

async function waitForDeviceIdentity(maxSec = 30) {
  const identityPath = join(APP_SUPPORT, 'clawx-device-identity.json');
  log(`waiting for device identity: ${identityPath}`);
  for (let i = 0; i < maxSec; i += 1) {
    if (existsSync(identityPath)) {
      const identity = loadDeviceIdentity();
      log(`device identity ready (deviceId=${identity.deviceId.slice(0, 12)}...)`);
      return identity;
    }
    await sleep(1000);
  }
  throw new Error(`device identity not found within ${maxSec}s`);
}

function buildConnectDeviceBlock(deviceIdentity, token, challengeNonce) {
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'ui';
  const role = 'operator';
  const payload = buildDeviceAuthPayload({
    deviceId: deviceIdentity.deviceId,
    clientId,
    clientMode,
    role,
    scopes: CONNECT_SCOPES,
    signedAtMs,
    token,
    nonce: challengeNonce,
  });
  return {
    id: deviceIdentity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(deviceIdentity.publicKeyPem),
    signature: signDevicePayload(deviceIdentity.privateKeyPem, payload),
    signedAt: signedAtMs,
    nonce: challengeNonce,
  };
}

function probeGatewayOnce() {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'scripts/gateway-ws-probe.mjs'),
      '--port',
      String(GATEWAY_PORT),
      '--timeout-ms',
      String(GATEWAY_PROBE_TIMEOUT_MS),
    ],
    { encoding: 'utf8' },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

async function waitForGatewayReady(label) {
  log(`${label}: polling gateway (every ${GATEWAY_POLL_INTERVAL_SEC}s, max ${GATEWAY_MAX_WAIT_SEC}s)`);
  const start = Date.now();
  while ((Date.now() - start) / 1000 < GATEWAY_MAX_WAIT_SEC) {
    if (probeGatewayOnce()) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log(`${label}: gateway ready in ${elapsed}s`);
      return;
    }
    await sleep(GATEWAY_POLL_INTERVAL_SEC * 1000);
  }
  throw new Error(`${label}: gateway not ready within ${GATEWAY_MAX_WAIT_SEC}s`);
}

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function buildExpectedDatePatterns(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const monthPadded = month.padStart(2, '0');
  const dayPadded = day.padStart(2, '0');

  return [
    `${year}-${monthPadded}-${dayPadded}`,
    `${year}/${month}/${day}`,
    `${year}年${month}月${day}日`,
    `${year}年${parseInt(month, 10)}月${parseInt(day, 10)}日`,
    `${parseInt(month, 10)}月${parseInt(day, 10)}日`,
  ];
}

function responseContainsTodayDate(text) {
  const normalized = text.replace(/\s+/g, '');
  const patterns = buildExpectedDatePatterns();
  return patterns.some((pattern) => normalized.includes(pattern.replace(/\s+/g, '')));
}

class GatewayWsClient {
  constructor(port, token, deviceIdentity) {
    this.port = port;
    this.token = token;
    this.deviceIdentity = deviceIdentity;
    this.ws = null;
    this.pending = new Map();
    this.eventHandlers = [];
  }

  async connect() {
    const wsUrl = `ws://127.0.0.1:${this.port}/ws`;
    log(`connecting gateway websocket: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('gateway websocket connect timeout')), 15000);
      this.ws.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    await new Promise((resolve, reject) => {
      let challengeNonce = null;
      const timeout = setTimeout(() => reject(new Error('connect.challenge timeout')), 15000);

      const onMessage = (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (message.type === 'event' && message.event === 'connect.challenge') {
          challengeNonce = message.payload?.nonce;
          if (!challengeNonce) {
            clearTimeout(timeout);
            reject(new Error('connect.challenge missing nonce'));
            return;
          }
          const connectId = `connect-${Date.now()}`;
          this.pending.set(connectId, {
            resolve: () => {
              clearTimeout(timeout);
              this.ws.off('message', onMessage);
              resolve();
            },
            reject: (error) => {
              clearTimeout(timeout);
              reject(error);
            },
          });
          this.ws.send(JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: GATEWAY_PROTOCOL_VERSION,
              maxProtocol: GATEWAY_PROTOCOL_VERSION,
              client: {
                id: 'gateway-client',
                displayName: 'ClawX CI Smoke',
                version: '1.0.0',
                platform: 'darwin',
                mode: 'ui',
              },
              auth: { token: this.token },
              caps: [],
              role: 'operator',
              scopes: CONNECT_SCOPES,
              device: buildConnectDeviceBlock(this.deviceIdentity, this.token, challengeNonce),
            },
          }));
          return;
        }

        if (message.type === 'res' && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.ok) pending.resolve(message.payload);
          else pending.reject(new Error(JSON.stringify(message.error ?? message)));
          return;
        }

        if (message.type === 'event') {
          for (const handler of this.eventHandlers) handler(message);
        }
      };

      this.ws.on('message', onMessage);
    });

    this.ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'res' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.payload);
        else pending.reject(new Error(JSON.stringify(message.error ?? message)));
        return;
      }
      if (message.type === 'event') {
        for (const handler of this.eventHandlers) handler(message);
      }
    });

    log('gateway websocket connected');
  }

  onEvent(handler) {
    this.eventHandlers.push(handler);
  }

  rpc(method, params, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway rpc timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.terminate();
    } catch {
      // ignore
    }
  }
}

async function runChatSmoke(gatewayToken) {
  const sessionKey = `agent:main:session-${Date.now()}`;
  const deviceIdentity = await waitForDeviceIdentity();
  const client = new GatewayWsClient(GATEWAY_PORT, gatewayToken, deviceIdentity);
  let streamedText = '';
  let runCompleted = false;

  await client.connect();
  client.onEvent((message) => {
    if (message.event !== 'agent') return;
    const payload = message.payload ?? message.params ?? {};
    if (payload.data?.phase === 'completed' || payload.data?.phase === 'done' || payload.data?.phase === 'finished') {
      runCompleted = true;
    }
    if (payload.state === 'delta' || payload.state === 'final') {
      const text = extractTextContent(payload.message?.content);
      if (text) streamedText = text;
    }
  });

  log(`creating chat session: ${sessionKey}`);
  log(`sending chat message: ${CHAT_MESSAGE}`);

  const idempotencyKey = randomUUID();
  let sendError = null;
  const sendPromise = client.rpc('chat.send', {
    sessionKey,
    message: CHAT_MESSAGE,
    deliver: false,
    idempotencyKey,
  }, (CHAT_WAIT_SEC + 30) * 1000).catch((error) => {
    sendError = error instanceof Error ? error.message : String(error);
    log(`chat.send error: ${sendError}`);
    return null;
  });

  const start = Date.now();
  let assistantText = '';

  while ((Date.now() - start) / 1000 < CHAT_WAIT_SEC) {
    await sleep(CHAT_POLL_INTERVAL_SEC * 1000);
    try {
      const history = await client.rpc('chat.history', { sessionKey, limit: 50 }, 30000);
      const messages = Array.isArray(history?.messages) ? history.messages : [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const historyText = extractTextContent(lastAssistant?.content);
      if (historyText) {
        assistantText = historyText;
        log(`assistant reply detected (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
        break;
      }
    } catch (error) {
      log(`chat.history poll warning: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (streamedText) {
      assistantText = streamedText;
      log(`assistant stream text detected (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
      break;
    }
    if (runCompleted && streamedText) {
      assistantText = streamedText;
      break;
    }
  }

  try {
    await sendPromise;
  } catch {
    // handled via sendError
  }

  if (!assistantText && sendError) {
    throw new Error(`chat.send failed: ${sendError}`);
  }

  if (!assistantText) {
    try {
      const history = await client.rpc('chat.history', { sessionKey, limit: 50 }, 30000);
      const messages = Array.isArray(history?.messages) ? history.messages : [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      assistantText = extractTextContent(lastAssistant?.content);
    } catch {
      // ignore
    }
  }

  client.close();

  if (!assistantText) {
    throw new Error(`no assistant reply within ${CHAT_WAIT_SEC}s`);
  }

  log(`assistant reply preview: ${assistantText.slice(0, 200).replace(/\s+/g, ' ')}`);
  if (!responseContainsTodayDate(assistantText)) {
    const expected = buildExpectedDatePatterns().join(', ');
    throw new Error(`assistant reply does not mention today's date (${TIMEZONE}); expected one of: ${expected}`);
  }

  log('assistant reply contains today\'s date');
}

async function main() {
  const totalStart = Date.now();
  log('=== extended smoke e2e start ===');

  log('step A/3: wait for packaged app CI provider setup (Main process, CLAWX_CI_SMOKE=1)');
  await waitForCiSmokeReady();

  log('step B/3: wait for gateway after provider config');
  await sleep(5000);
  await waitForGatewayReady('after provider config');

  const gatewayToken = readGatewayToken();
  log('step C/3: send chat and validate date in model reply');
  await runChatSmoke(gatewayToken);

  const totalSec = Math.round((Date.now() - totalStart) / 1000);
  log(`=== extended smoke e2e PASSED (e2e time ${totalSec}s) ===`);
}

main().catch((error) => {
  log(`=== extended smoke e2e FAILED ===`);
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
