import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalPortal } from '@/components/ui/modal-portal';

describe('ModalPortal focus delivery', () => {
  it('delivers React focus and blur while excluding the outer document focus trap', () => {
    const focused = vi.fn();
    const blurred = vi.fn();
    const outerFocus = vi.fn();
    const outerBlur = vi.fn();
    const view = render(<ModalPortal><input aria-label="Secret" onFocus={focused} onBlur={blurred} /></ModalPortal>);
    document.addEventListener('focusin', outerFocus);
    document.addEventListener('focusout', outerBlur);
    try {
      const input = screen.getByRole('textbox', { name: 'Secret' });
      fireEvent.focusIn(input);
      fireEvent.focusOut(input);
      expect(focused).toHaveBeenCalledTimes(1);
      expect(blurred).toHaveBeenCalledTimes(1);
      expect(outerFocus).not.toHaveBeenCalled();
      expect(outerBlur).not.toHaveBeenCalled();
      view.unmount();
      fireEvent.focusIn(document.body);
      expect(outerFocus).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      document.removeEventListener('focusin', outerFocus);
      document.removeEventListener('focusout', outerBlur);
    }
  });

  it('guards first focus entering the portal without intercepting unrelated focus changes', () => {
    const outerBlur = vi.fn();
    const view = render(<><button>Outside</button><ModalPortal><input aria-label="Inside" /></ModalPortal></>);
    document.addEventListener('focusout', outerBlur);
    try {
      const outside = screen.getByRole('button', { name: 'Outside' });
      const inside = screen.getByRole('textbox', { name: 'Inside' });
      fireEvent.focusOut(outside, { relatedTarget: inside });
      expect(outerBlur).not.toHaveBeenCalled();
      fireEvent.focusOut(outside, { relatedTarget: document.body });
      expect(outerBlur).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      document.removeEventListener('focusout', outerBlur);
    }
  });
});
