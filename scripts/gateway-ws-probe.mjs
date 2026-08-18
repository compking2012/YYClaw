#!/usr/bin/env node
/**
 * Probe OpenClaw Gateway readiness via WebSocket connect.challenge.
 * Mirrors electron/gateway/ws-client.ts probeGatewayReady().
 */
import WebSocket from 'ws';

function parseArgs(argv) {
  let port = 18789;
  let timeoutMs = 30_000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]);
      continue;
    }
    if (arg === '--timeout-ms' && argv[i + 1]) {
      timeoutMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/gateway-ws-probe.mjs [--port 18789] [--timeout-ms 30000]');
      process.exit(0);
    }
  }

  if (!Number.isFinite(port) || port <= 0) {
    console.error('[gateway-ws-probe] invalid --port');
    process.exit(2);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error('[gateway-ws-probe] invalid --timeout-ms');
    process.exit(2);
  }

  return { port, timeoutMs };
}

function probeGatewayReady(port, timeoutMs) {
  const url = `ws://127.0.0.1:${port}/ws`;
  console.log(`[gateway-ws-probe] connecting to ${url} (timeout ${timeoutMs}ms)`);

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;

    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      if (ok) {
        console.log(`[gateway-ws-probe] PASS: ${detail}`);
        resolve(true);
        return;
      }
      console.error(`[gateway-ws-probe] FAIL: ${detail}`);
      resolve(false);
    };

    let timer = setTimeout(() => {
      finish(false, 'timeout waiting for connect.challenge');
    }, timeoutMs);

    ws.on('open', () => {
      console.log('[gateway-ws-probe] socket open, waiting for connect.challenge...');
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish(false, 'timeout after socket open (no connect.challenge)');
      }, timeoutMs);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.event === 'connect.challenge') {
          finish(true, 'received connect.challenge');
        }
      } catch {
        // ignore malformed payloads
      }
    });

    ws.on('error', (error) => {
      finish(false, `socket error: ${error instanceof Error ? error.message : String(error)}`);
    });

    ws.on('close', () => {
      finish(false, 'socket closed before connect.challenge');
    });
  });
}

const { port, timeoutMs } = parseArgs(process.argv.slice(2));
const ready = await probeGatewayReady(port, timeoutMs);
process.exit(ready ? 0 : 1);
