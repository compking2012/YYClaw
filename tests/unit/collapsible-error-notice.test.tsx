import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleErrorNotice } from '@/components/common/CollapsibleErrorNotice';
import { getMessageErrorMessage, isAssistantErrorMessage } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

describe('CollapsibleErrorNotice', () => {
  it('renders collapsed by default: just a low-key title pill, no detail card', () => {
    render(<CollapsibleErrorNotice error="boom" testId="err" />);

    const root = screen.getByTestId('err');
    expect(root).toBeInTheDocument();
    // No expanded detail card until the user clicks.
    expect(root.querySelector('.rounded-xl')).toBeNull();
  });

  it('expands to reveal the full detail card on click, and collapses again on a second click', () => {
    const onDismiss = () => {};
    render(
      <CollapsibleErrorNotice
        error="boom"
        onDismiss={onDismiss}
        testId="err"
        dismissTestId="err-dismiss"
      />,
    );

    const root = screen.getByTestId('err');
    const toggle = root.querySelector('button') as HTMLElement;
    expect(toggle).not.toBeNull();

    // Collapsed: no dismiss affordance yet — it only lives inside the
    // expanded detail card.
    expect(screen.queryByTestId('err-dismiss')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(root.querySelector('.rounded-xl')).not.toBeNull();
    expect(screen.getByTestId('err-dismiss')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(root.querySelector('.rounded-xl')).toBeNull();
  });

  it('renders nothing for benign gateway-lifecycle errors', () => {
    render(<CollapsibleErrorNotice error="Gateway stopped or in error state" testId="benign" />);
    expect(screen.queryByTestId('benign')).not.toBeInTheDocument();
  });
});

describe('isAssistantErrorMessage', () => {
  it('flags assistant messages that stopped with an error', () => {
    expect(isAssistantErrorMessage({ role: 'assistant', content: '', stopReason: 'error' })).toBe(true);
    expect(isAssistantErrorMessage({ role: 'assistant', content: '', stop_reason: 'error' })).toBe(true);
    expect(isAssistantErrorMessage({ role: 'assistant', content: '', isError: true } as RawMessage)).toBe(true);
  });

  it('does not flag normal assistant messages or user messages', () => {
    expect(isAssistantErrorMessage({ role: 'assistant', content: 'ok', stopReason: 'end_turn' })).toBe(false);
    expect(isAssistantErrorMessage({ role: 'assistant', content: 'ok' })).toBe(false);
    expect(isAssistantErrorMessage({ role: 'user', content: 'hi', stopReason: 'error' })).toBe(false);
    expect(isAssistantErrorMessage(null)).toBe(false);
    expect(isAssistantErrorMessage('nope')).toBe(false);
  });
});

describe('getMessageErrorMessage', () => {
  it('prefers the errorMessage field', () => {
    expect(getMessageErrorMessage({ role: 'assistant', content: 'x', errorMessage: '404 Resource not found' })).toBe('404 Resource not found');
  });

  it('falls back to the error_message field', () => {
    expect(getMessageErrorMessage({ role: 'assistant', content: 'x', error_message: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
  });

  it('returns null when neither field is present', () => {
    expect(getMessageErrorMessage({ role: 'assistant', content: 'something went wrong' })).toBeNull();
    expect(getMessageErrorMessage(null)).toBeNull();
    expect(getMessageErrorMessage('nope')).toBeNull();
  });
});
