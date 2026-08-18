/**
 * Short-lived WebSocket to Farm: upload skill zip and receive publish result on the same connection.
 * Protocol matches yyclawmanager GET /api/v1/admin/workspace-skills/upload-ws (30s session cap, 无鉴权).
 */
import fs from 'node:fs';
import WebSocket from 'ws';
import pkg from '../../package.json';
import { proxyAwareFetch } from '../utils/proxy-fetch';

const WS_SESSION_MS = 30_000;

export type SkillUploadWsResponse = {
  ok: boolean;
  skill_id?: string;
  request_id?: number;
  review_no?: string;
  status?: string;
  error?: string;
  code?: string;
  display_name?: string;
  version?: string;
  version_base?: string;
  existing_skill_ids?: string[];
};

export type PublishedMarketplaceSkill = {
  skill_id: string;
  display_name?: string;
  description?: string;
  version?: string;
  version_base?: string;
  archive_hash: string;
  size_bytes: number;
  published_at?: string;
};

export type MarketplaceSkillReviewRequest = {
  id: number;
  review_no?: string;
  request_type?: 'publish' | 'unlist' | string;
  status?: 'pending' | 'approved' | 'rejected' | string;
  target_skill_id?: string;
  display_name?: string;
  description?: string;
  original_filename?: string;
  archive_hash?: string;
  version?: string;
  version_base?: string;
  size_bytes?: number;
  review_comments?: string;
  published_skill_id?: string;
  reviewed_at?: string;
  created_at?: string;
  updated_at?: string;
};

function httpBaseToWsBase(httpBase: string): string {
  const b = httpBase.replace(/\/+$/, '');
  if (b.startsWith('https://')) {
    return `wss://${b.slice('https://'.length)}`;
  }
  if (b.startsWith('http://')) {
    return `ws://${b.slice('http://'.length)}`;
  }
  return b;
}

export async function uploadSkillZipViaFarmWs(opts: {
  zipFilePath: string;
  clientId: string;
  confirmUnsafe?: boolean;
  overwriteSameName?: boolean;
  author?: string;
  version?: string;
  category?: string;
}): Promise<SkillUploadWsResponse> {
  const raw = String((pkg as { farmApiBaseUrl?: string }).farmApiBaseUrl ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'SKILLS_MARKETPLACE_NO_BASE_URL' };
  }

  const zipBuf = fs.readFileSync(opts.zipFilePath);
  if (zipBuf.length === 0) {
    return { ok: false, error: 'SKILL_UPLOAD_WS_EMPTY_ZIP' };
  }

  const filename = opts.zipFilePath.split(/[/\\]/).pop() || 'skill.zip';
  const base = httpBaseToWsBase(raw);
  const url = `${base}/api/v1/admin/workspace-skills/upload-ws`;

  return await new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const finish = (r: SkillUploadWsResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    const timer = setTimeout(() => {
      try {
        ws?.terminate();
      } catch {
        /* ignore */
      }
      finish({ ok: false, error: 'SKILL_UPLOAD_WS_CLIENT_TIMEOUT' });
    }, WS_SESSION_MS);

    ws = new WebSocket(url);

    ws.on('error', (err) => {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });

    ws.on('close', () => {
      if (!settled) {
        finish({ ok: false, error: 'SKILL_UPLOAD_WS_CLOSED' });
      }
    });

    ws.on('open', () => {
      try {
        const meta = JSON.stringify({
          v: 1,
          filename,
          client_id: opts.clientId,
          category: opts.category?.trim() || '',
          confirm_unsafe: !!opts.confirmUnsafe,
          overwrite_same_name: !!opts.overwriteSameName,
          author: opts.author?.trim() || '',
          version: opts.version?.trim() || '',
        });
        ws!.send(meta);
        ws!.send(zipBuf, { binary: true });
      } catch (e) {
        finish({ ok: false, error: String(e) });
      }
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const j = JSON.parse(text) as SkillUploadWsResponse;
        finish({
          ok: !!j.ok,
          skill_id: j.skill_id,
          request_id: j.request_id,
          review_no: j.review_no,
          status: j.status,
          error: j.error,
          code: j.code,
          display_name: j.display_name,
          version: j.version,
          version_base: j.version_base,
          existing_skill_ids: j.existing_skill_ids,
        });
      } catch (e) {
        finish({ ok: false, error: `SKILL_UPLOAD_WS_BAD_RESPONSE: ${String(e)}` });
      }
    });
  });
}

function farmHttpBase(): string | null {
  const raw = String((pkg as { farmApiBaseUrl?: string }).farmApiBaseUrl ?? '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

export async function listPublishedMarketplaceSkills(clientId: string): Promise<PublishedMarketplaceSkill[]> {
  const base = farmHttpBase();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }
  const url = `${base}/api/v1/workspace-skills/my-published?client_id=${encodeURIComponent(clientId)}`;
  const res = await proxyAwareFetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const parsed = JSON.parse(text || '{}') as { skills?: PublishedMarketplaceSkill[] };
  return parsed.skills ?? [];
}

export async function listMarketplaceSkillReviewRequests(clientId: string, limit = 100): Promise<MarketplaceSkillReviewRequest[]> {
  const base = farmHttpBase();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const url = `${base}/api/v1/workspace-skills/my-requests?client_id=${encodeURIComponent(clientId)}&limit=${safeLimit}`;
  const res = await proxyAwareFetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const parsed = JSON.parse(text || '{}') as { requests?: MarketplaceSkillReviewRequest[] };
  return parsed.requests ?? [];
}

export async function requestMarketplaceSkillUnlist(clientId: string, skillId: string): Promise<{ request_id: number; review_no?: string; status: string }> {
  const base = farmHttpBase();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }
  const res = await proxyAwareFetch(`${base}/api/v1/workspace-skills/unlist-requests`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, skill_id: skillId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return JSON.parse(text || '{}') as { request_id: number; review_no?: string; status: string };
}

/** Revoke a still-pending publish/unlist review request the client submitted. */
export async function cancelMarketplaceSkillReviewRequest(
  clientId: string,
  requestId: number,
): Promise<{ request_id: number; status: string }> {
  const base = farmHttpBase();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }
  const res = await proxyAwareFetch(`${base}/api/v1/workspace-skills/cancel-request`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, request_id: requestId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return JSON.parse(text || '{}') as { request_id: number; status: string };
}
