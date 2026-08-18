import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentPoolPicker } from '@/components/office/AgentPoolPicker';
import type { AgentSummary } from '@/types/agent';

const AGENTS: AgentSummary[] = [
  { id: 'a1', name: 'Dev' } as AgentSummary,
  { id: 'a2', name: 'QA' } as AgentSummary,
];

describe('AgentPoolPicker interactionMode', () => {
  it('unbind-missing shows red missing chip with X and hides available bind panel', () => {
    const onChange = vi.fn();
    render(
      <AgentPoolPicker
        agents={AGENTS}
        selectedAgentIds={['a1', 'ghost']}
        coordinatorAgentId="a1"
        agentNameHints={{ ghost: 'Ghost' }}
        interactionMode="unbind-missing"
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('office-agent-pool-picker')).toHaveAttribute(
      'data-interaction-mode',
      'unbind-missing',
    );
    expect(screen.getByTestId('office-agent-missing-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('office-agent-unbind-missing-ghost')).toBeInTheDocument();
    expect(screen.queryByTestId('office-agent-unbind-a1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('office-agent-pool-a2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('office-agent-unbind-missing-ghost'));
    expect(onChange).toHaveBeenCalledWith({
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      removedAgentIds: ['ghost'],
    });
  });

  it('unbinding missing coordinator clears it and leaves select enabled for known members', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AgentPoolPicker
        agents={AGENTS}
        selectedAgentIds={['a1', 'ghost-coord']}
        coordinatorAgentId="ghost-coord"
        agentNameHints={{ 'ghost-coord': 'Ghost Coord' }}
        interactionMode="unbind-missing"
        onChange={onChange}
      />,
    );

    const select = screen.getByTestId('office-agent-coordinator-select');
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('data-coordinator-missing', 'true');

    fireEvent.click(screen.getByTestId('office-agent-unbind-missing-ghost-coord'));
    expect(onChange).toHaveBeenCalledWith({
      agentIds: ['a1'],
      coordinatorAgentId: '',
      removedAgentIds: ['ghost-coord'],
    });

    rerender(
      <AgentPoolPicker
        agents={AGENTS}
        selectedAgentIds={['a1']}
        coordinatorAgentId=""
        interactionMode="unbind-missing"
        onChange={onChange}
      />,
    );
    const selectAfter = screen.getByTestId('office-agent-coordinator-select');
    expect(selectAfter).not.toBeDisabled();
    expect(selectAfter).toHaveAttribute('data-coordinator-empty', 'true');
  });

  it('view shows missing chip without X', () => {
    render(
      <AgentPoolPicker
        agents={AGENTS}
        selectedAgentIds={['a1', 'ghost']}
        coordinatorAgentId="a1"
        agentNameHints={{ ghost: 'Ghost' }}
        interactionMode="view"
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId('office-agent-missing-ghost')).toBeInTheDocument();
    expect(screen.queryByTestId('office-agent-unbind-missing-ghost')).not.toBeInTheDocument();
  });
});
