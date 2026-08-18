// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { media: { saveImage: vi.fn().mockResolvedValue({ success: true }) } },
}));

import { AcpImagePart } from '@/pages/Chat/AcpImagePart';
import { useArtifactPanel } from '@/stores/artifact-panel';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => {
  cleanup();
  useArtifactPanel.setState({ open: false, tab: 'preview', focusedFile: null });
});

describe('AcpImagePart', () => {
  it('opens the right-side preview with the attachment ref on click', () => {
    const attachmentFileRef = {
      sessionKey: 'agent:main:session',
      generation: 1,
      uri: '/ws/generated-images/great_wall---abc.png',
    };
    render(
      <AcpImagePart
        part={{ kind: 'image', source: PNG_DATA_URL, mimeType: 'image/png', attachmentFileRef }}
      />,
    );

    const figure = screen.getByTestId('acp-image-part');
    expect(figure.getAttribute('role')).toBe('button');
    fireEvent.click(figure);

    const state = useArtifactPanel.getState();
    expect(state.open).toBe(true);
    expect(state.tab).toBe('preview');
    expect(state.focusedFile?.attachmentFileRef).toEqual(attachmentFileRef);
    expect(state.focusedFile?.contentType).toBe('snapshot');
  });

  it('is not clickable when the image has no attachment ref', () => {
    render(<AcpImagePart part={{ kind: 'image', source: PNG_DATA_URL, mimeType: 'image/png' }} />);

    const figure = screen.getByTestId('acp-image-part');
    expect(figure.getAttribute('role')).toBeNull();
    fireEvent.click(figure);

    expect(useArtifactPanel.getState().open).toBe(false);
  });
});
