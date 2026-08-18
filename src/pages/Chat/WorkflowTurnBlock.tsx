/**
 * WorkflowTurnBlock — the in-conversation render of one workflow card, placed at
 * its chronological position by {@link buildConversationBlocks}.
 *
 * An ENGINE (single-agent auto) workflow never sends an ACP prompt, so its
 * triggering user message and synthesized reply live only on the card; we
 * render them here as normal-looking user/assistant bubbles (reusing
 * {@link AcpMessageSegment}) with the compact {@link WorkflowInlineCard} between
 * them. An OBSERVED card's real conversation already lives in the ACP timeline,
 * so we render only the compact card link.
 *
 * This is render-only: nothing here mutates the ACP timeline store.
 */
import { useTranslation } from 'react-i18next';
import type { MessageSegmentItem } from '@/lib/acp/timeline-types';
import type { WorkflowCardRef } from '@/types/workflow';
import { AcpMessageSegment } from './AcpMessageSegment';
import { WorkflowInlineCard } from './WorkflowInlineCard';
import { workflowFinalMessageId } from './workflow-timeline-merge';

function syntheticSegment(
  id: string,
  role: 'user' | 'assistant',
  text: string,
): MessageSegmentItem {
  return {
    kind: 'message-segment',
    id,
    role,
    messageId: id,
    segmentIndex: 0,
    parts: [{ kind: 'markdown', text }],
  };
}

export function WorkflowTurnBlock({ card }: { card: WorkflowCardRef }) {
  const { t } = useTranslation('chat');

  // Observed: the ACP transcript already carries the turn — only the card link.
  if (card.source === 'observed') {
    return <WorkflowInlineCard runId={card.runId} />;
  }

  const finalText = card.finalText?.trim();

  return (
    <div className="flex flex-col gap-4" data-testid="workflow-turn-block">
      {card.userText.trim() && (
        <AcpMessageSegment item={syntheticSegment(card.userMessageId, 'user', card.userText)} />
      )}
      <WorkflowInlineCard runId={card.runId} />
      {finalText ? (
        <AcpMessageSegment
          item={syntheticSegment(workflowFinalMessageId(card.runId), 'assistant', finalText)}
        />
      ) : (
        card.status === 'failed' && (
          <div className="ml-11 text-sm text-destructive" data-testid="workflow-turn-error">
            {card.error ? t('workflow.failedWithError', { error: card.error }) : t('workflow.failed')}
          </div>
        )
      )}
    </div>
  );
}
