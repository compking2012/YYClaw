import { createHash } from 'node:crypto';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function looksLikeConfigRoot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ['agents', 'channels', 'bindings', 'tools', 'session', 'gateway', 'models'];
  return keys.some((key) => key in row);
}

export function normalizeConfigPayload(payload: unknown): Record<string, unknown> {
  if (looksLikeConfigRoot(payload)) {
    return payload as Record<string, unknown>;
  }
  const row = asRecord(payload) ?? {};
  const candidates = [row.config, row.data, row.value, row.payload, row.result];
  for (const candidate of candidates) {
    if (looksLikeConfigRoot(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return row;
}

export function resolveSnapshotMeta(payload: unknown): {
  exists: boolean;
  hash: string | null;
  raw: string | null;
} {
  const row = asRecord(payload);
  let exists = true;
  let hash: string | null = null;
  let raw: string | null = null;
  const candidates = [row, asRecord(row?.payload), asRecord(row?.data), asRecord(row?.result)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if ('exists' in candidate) {
      exists = candidate.exists !== false;
    }
    const candidateHash = asString(candidate.hash).trim();
    if (candidateHash) {
      hash = candidateHash;
    }
    const candidateRaw = typeof candidate.raw === 'string' ? candidate.raw : '';
    if (candidateRaw.trim()) {
      raw = candidateRaw;
    }
    if (hash) break;
  }
  return { exists, hash, raw };
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
