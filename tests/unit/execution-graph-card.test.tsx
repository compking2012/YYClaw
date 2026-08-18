import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'executionGraph.collapsedSummary') {
        return `collapsed ${String(params?.toolCount ?? '')} ${String(params?.processCount ?? '')}`.trim();
      }
      if (key === 'executionGraph.agentRun') return `${String(params?.agent ?? '')} execution`;
      if (key === 'executionGraph.title') return 'Execution Graph';
      if (key === 'executionGraph.collapseAction') return 'Collapse execution graph';
      if (key === 'executionGraph.agentReplyHint') return 'Resolved in the assistant reply below';
      if (key === 'executionGraph.thinkingLabel') return 'Thinking';
      if (key.startsWith('taskPanel.stepStatus.')) return key.split('.').at(-1) ?? key;
      return key;
    },
  }),
}));

describe('ExecutionGraphCard', () => {
  it('does not render icon-only rows for empty thinking or message steps', () => {
    render(
      <ExecutionGraphCard
        agentLabel="Main"
        active={false}
        expanded
        steps={[
          {
            id: 'empty-thinking',
            label: 'Thinking',
            status: 'completed',
            kind: 'thinking',
            detail: '   ',
            depth: 1,
          },
          {
            id: 'empty-message',
            label: 'Message',
            status: 'completed',
            kind: 'message',
            depth: 1,
          },
          {
            id: 'visible-message',
            label: 'Message',
            status: 'completed',
            kind: 'message',
            detail: 'Visible process note.',
            depth: 1,
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId('chat-execution-step')).toHaveLength(1);
    expect(screen.getByText('Visible process note.')).toBeInTheDocument();
  });
});
