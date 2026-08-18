import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { getProviderAccount } from './providers/provider-store';
import { getApiKey } from '../utils/secure-storage';
import { getProviderTypeInfo } from '../utils/provider-registry';
import { normalizeModelTypes } from '../shared/providers/model-kind';
import { getVoiceRuntimeParams, isSupportedVoiceRuntime } from '../utils/voice-runtime';
import {
  clearTranscriptionConfigFromOpenClaw,
  clearTtsConfigFromOpenClaw,
  readTranscriptionRuntime,
  readVoiceConfigSelections,
  syncTranscriptionConfigToOpenClaw,
  syncTtsConfigToOpenClaw,
  type VoiceProviderConfig,
} from '../utils/openclaw-voice';
import { scheduleGatewayRefresh } from './providers/provider-runtime-sync';

const AUDIO_EXT_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.pcm': 'audio/L16',
};

function audioMimeFor(audioPath: string, outputFormat?: string): string {
  const ext = extname(audioPath).toLowerCase();
  if (AUDIO_EXT_MIME[ext]) return AUDIO_EXT_MIME[ext];
  if (outputFormat) {
    const fmt = outputFormat.toLowerCase();
    if (fmt.includes('mp3')) return 'audio/mpeg';
    if (fmt.includes('opus') || fmt.includes('ogg')) return 'audio/ogg';
    if (fmt.includes('wav')) return 'audio/wav';
    if (fmt.includes('pcm')) return 'audio/L16';
  }
  return 'audio/mpeg';
}

function audioExtForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

async function isReadableAudioFile(candidate: string): Promise<boolean> {
  if (!candidate || !isAbsolute(candidate)) return false;
  const info = await stat(candidate).catch(() => null);
  return Boolean(info && info.isFile());
}

async function resolveVoiceAccountConfig(
  accountId: string,
  kind: 'tts' | 'transcription',
  modelOverride?: string,
): Promise<{ provider: string; config: VoiceProviderConfig } | { error: string }> {
  const account = await getProviderAccount(accountId);
  if (!account) return { error: 'Account not found' };

  const typeInfo = getProviderTypeInfo(account.vendorId);
  const provider = typeInfo?.voiceRuntimeProviderId || 'openai';
  if (!isSupportedVoiceRuntime(provider)) {
    return { error: `Unsupported voice runtime: ${provider}` };
  }

  const apiKey = (await getApiKey(account.id)) || undefined;
  const kinds = normalizeModelTypes(typeInfo?.modelType);
  const modelIndex = kinds.indexOf(kind);
  const modelArray = (Array.isArray(account.model) ? account.model : [account.model || ''])
    .flatMap((id) => (id || '').split(','));
  const accountModel = modelIndex >= 0 ? (modelArray[modelIndex] || '').trim() : '';
  const model = modelOverride?.trim() || accountModel;

  return {
    provider,
    config: {
      ...(model ? { model } : {}),
      ...(account.baseUrl ? { baseUrl: account.baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...getVoiceRuntimeParams(provider, kind),
      ...(account.modelParams?.[kind] ?? {}),
    },
  };
}

export function createVoiceApi(ctx: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['voice'] {
  return {
    configStatus: async () => {
      const selections = await readVoiceConfigSelections();
      const configured = {
        tts: Boolean(selections.tts.provider),
        transcription: Boolean(selections.transcription.provider),
        realtime: Boolean(selections.realtime.provider),
      };
      return { success: true, configured, ...configured };
    },
    selections: async () => ({ success: true, selections: await readVoiceConfigSelections() }),
    ttsAudio: async (payload) => {
      if (!payload?.text?.trim()) return { success: false, error: 'text is required' };
      const selections = await readVoiceConfigSelections();
      if (!selections.tts.provider) return { success: false, error: 'tts-not-configured' };
      const rpcParams: Record<string, unknown> = { text: payload.text };
      if (payload.provider) rpcParams.provider = payload.provider;
      if (payload.voiceId) rpcParams.voiceId = payload.voiceId;
      if (payload.modelId) rpcParams.modelId = payload.modelId;

      const result = await ctx.gatewayManager.rpc<{
        audioPath?: string;
        provider?: string;
        outputFormat?: string;
      }>('tts.convert', rpcParams, 60000);
      const audioPath = result?.audioPath;
      if (!audioPath) return { success: false, error: 'TTS returned no audio' };
      if (!(await isReadableAudioFile(audioPath))) {
        return { success: false, error: `Audio file not readable: ${audioPath}` };
      }
      const bytes = await readFile(audioPath);
      return {
        success: true,
        base64: bytes.toString('base64'),
        mimeType: audioMimeFor(audioPath, result?.outputFormat),
        provider: result?.provider,
        outputFormat: result?.outputFormat,
      };
    },
    transcribe: async (payload) => {
      if (!payload?.audioBase64) return { success: false, error: 'audioBase64 is required' };
      const selections = await readVoiceConfigSelections();
      if (!selections.transcription.provider) return { success: false, error: 'transcription-not-configured' };
      const runtime = await readTranscriptionRuntime();
      if (!runtime.apiKey) return { success: false, error: 'Transcription provider API key is not configured' };
      const bytes = Buffer.from(payload.audioBase64, 'base64');
      const mimeType = payload.mimeType || 'audio/webm';
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `audio.${audioExtForMime(mimeType)}`);
      form.append('model', runtime.model);
      form.append('response_format', 'json');
      if (payload.language?.trim()) form.append('language', payload.language.trim());

      const response = await proxyAwareFetch(`${runtime.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.apiKey}` },
        body: form,
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { success: false, error: `Transcription failed (${response.status}): ${errText.slice(0, 300)}` };
      }
      const json = await response.json().catch(() => null) as { text?: string } | null;
      return { success: true, text: json?.text ?? '' };
    },
    setTtsAccount: async (payload) => {
      const resolved = await resolveVoiceAccountConfig(payload.accountId, 'tts', payload.model);
      if ('error' in resolved) return { success: false, error: resolved.error };
      await syncTtsConfigToOpenClaw(resolved);
      scheduleGatewayRefresh(ctx.gatewayManager, `OpenClaw config written after TTS account (${payload.accountId})`);
      return { success: true };
    },
    clearTtsAccount: async () => {
      await clearTtsConfigFromOpenClaw();
      scheduleGatewayRefresh(ctx.gatewayManager, 'OpenClaw config written after clearing TTS config');
      return { success: true };
    },
    setTranscriptionAccount: async (payload) => {
      const resolved = await resolveVoiceAccountConfig(payload.accountId, 'transcription', payload.model);
      if ('error' in resolved) return { success: false, error: resolved.error };
      await syncTranscriptionConfigToOpenClaw(resolved);
      scheduleGatewayRefresh(ctx.gatewayManager, `OpenClaw config written after transcription account (${payload.accountId})`);
      return { success: true };
    },
    clearTranscriptionAccount: async () => {
      await clearTranscriptionConfigFromOpenClaw();
      scheduleGatewayRefresh(ctx.gatewayManager, 'OpenClaw config written after clearing transcription config');
      return { success: true };
    },
  };
}
