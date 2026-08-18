import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import { resolvePromptOptimizationStatsForMessage } from '@/stores/chat/prompt-optimization-stats';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'promptOptimization.footer' && params) {
        return `Optimized/total chars: ${params.optimized}/${params.total} (${params.percent}%)`;
      }
      return key;
    },
  }),
}));

function PromptOptimizationFooter({
  enabled,
  message,
  stats,
}: {
  enabled: boolean;
  message: RawMessage;
  stats: Record<string, { optimized: number; total: number; percent: number }>;
}) {
  const promptStats = resolvePromptOptimizationStatsForMessage(message, stats);
  if (!enabled || !promptStats || message.role !== 'assistant') return null;
  const line = `Optimized/total chars: ${promptStats.optimized}/${promptStats.total} (${promptStats.percent}%)`;
  return (
    <p data-testid="prompt-optimization-stats" className="text-xs text-muted-foreground pl-11">
      {line}
    </p>
  );
}

describe('prompt optimization footer', () => {
  const assistantMsg: RawMessage = {
    role: 'assistant',
    content: 'Hello',
    id: 'run-abc123',
  };

  it('renders stats when optimization is enabled', () => {
    render(
      <PromptOptimizationFooter
        enabled
        message={assistantMsg}
        stats={{ abc123: { optimized: 120, total: 500, percent: 24 } }}
      />,
    );
    expect(screen.getByTestId('prompt-optimization-stats')).toHaveTextContent(
      'Optimized/total chars: 120/500 (24%)',
    );
  });

  it('hides footer when optimization is disabled', () => {
    render(
      <PromptOptimizationFooter
        enabled={false}
        message={assistantMsg}
        stats={{ abc123: { optimized: 120, total: 500, percent: 24 } }}
      />,
    );
    expect(screen.queryByTestId('prompt-optimization-stats')).toBeNull();
  });
});
