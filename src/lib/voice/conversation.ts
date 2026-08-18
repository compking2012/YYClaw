/**
 * Continuous voice conversation via OpenClaw Talk realtime (gateway-relay).
 *
 * The gateway relays both directions: we stream mic audio up with
 * `talk.session.appendAudio` and play assistant audio from `output.audio.delta`
 * events. The server performs VAD/turn segmentation, so the client does not
 * detect silence. Barge-in: when the user speaks while the assistant is
 * talking, we `talk.session.cancelOutput` and clear local playback.
 */
import { gatewayRpc } from './gateway';
import { startCapture, type CaptureHandle } from './capture';
import { PcmStreamPlayer } from './pcm-player';
import type { VoiceEncoding } from './encoding';
import {
  subscribeTalkSession,
  isTranscriptEvent,
  isFinalTranscript,
  isOutputAudioStart,
  isOutputAudioDone,
  isClearEvent,
  isSessionError,
  talkEventText,
  talkEventRole,
  talkEventAudioBase64,
} from './talk-events';

export type ConversationPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface TalkSessionCreateResult {
  sessionId: string;
  audio?: {
    inputEncoding?: VoiceEncoding;
    inputSampleRateHz?: number;
    outputEncoding?: VoiceEncoding;
    outputSampleRateHz?: number;
  };
}

export interface ConversationCallbacks {
  onPhase?: (phase: ConversationPhase) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, final: boolean) => void;
  onLevel?: (rms: number) => void;
  onError?: (error: Error) => void;
}

export interface ConversationHandle {
  stop: () => Promise<void>;
}

/** RMS over this threshold while the assistant speaks triggers barge-in. */
const BARGE_IN_RMS = 0.08;

export async function startConversation(callbacks: ConversationCallbacks): Promise<ConversationHandle> {
  const session = await gatewayRpc<TalkSessionCreateResult>('talk.session.create', {
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
  });
  const sessionId = session.sessionId;
  const inEncoding: VoiceEncoding = session.audio?.inputEncoding ?? 'pcm16';
  const inRate = session.audio?.inputSampleRateHz ?? 24000;
  const outRate = session.audio?.outputSampleRateHz ?? 24000;

  const player = new PcmStreamPlayer(outRate);
  let phase: ConversationPhase = 'listening';
  let speaking = false;
  const setPhase = (next: ConversationPhase) => {
    phase = next;
    callbacks.onPhase?.(next);
  };
  setPhase('listening');

  const cancelOutput = () => {
    if (!speaking) return;
    speaking = false;
    player.clear();
    void gatewayRpc('talk.session.cancelOutput', { sessionId, reason: 'barge-in' }).catch(() => {});
    setPhase('listening');
  };

  const unsubscribe = subscribeTalkSession(sessionId, (evt) => {
    if (isSessionError(evt)) {
      callbacks.onError?.(new Error('Talk session error'));
      return;
    }
    if (isTranscriptEvent(evt)) {
      const text = talkEventText(evt);
      const role = talkEventRole(evt) ?? 'assistant';
      if (text !== undefined) callbacks.onTranscript?.(role, text, isFinalTranscript(evt));
      if (role === 'user' && phase === 'listening') setPhase('thinking');
      return;
    }
    if (isOutputAudioStart(evt)) {
      speaking = true;
      setPhase('speaking');
      return;
    }
    const audio = talkEventAudioBase64(evt);
    if (audio) {
      speaking = true;
      if (phase !== 'speaking') setPhase('speaking');
      player.enqueue(audio);
      return;
    }
    if (isOutputAudioDone(evt)) {
      speaking = false;
      setPhase('listening');
      return;
    }
    if (isClearEvent(evt)) {
      speaking = false;
      player.clear();
      setPhase('listening');
    }
  });

  let capture: CaptureHandle | null = null;
  try {
    capture = await startCapture({
      encoding: inEncoding,
      targetSampleRate: inRate,
      onLevel: (rms) => {
        callbacks.onLevel?.(rms);
        if (speaking && rms > BARGE_IN_RMS) cancelOutput();
      },
      onError: callbacks.onError,
      onChunk: (audioBase64) => {
        void gatewayRpc('talk.session.appendAudio', { sessionId, audioBase64 }).catch((error) => {
          callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        });
      },
    });
  } catch (error) {
    unsubscribe();
    player.dispose();
    await gatewayRpc('talk.session.close', { sessionId }).catch(() => {});
    throw error;
  }

  return {
    stop: async () => {
      capture?.stop();
      player.dispose();
      unsubscribe();
      setPhase('idle');
      await gatewayRpc('talk.session.close', { sessionId }).catch(() => {});
    },
  };
}
