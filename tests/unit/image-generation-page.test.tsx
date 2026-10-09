import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationPage } from '@/pages/ImageGeneration';

vi.mock('@/components/settings/ImageGenerationSettings', () => ({
  ImageGenerationSettings: () => <div data-testid="image-generation-settings" />,
}));

describe('standalone image generation page', () => {
  it('embeds the shared image endpoint settings instead of a separate configuration flow', () => {
    render(<ImageGenerationPage />);
    expect(screen.getByTestId('image-generation-page')).toContainElement(screen.getByTestId('image-generation-settings'));
    expect(screen.getAllByTestId('image-generation-settings')).toHaveLength(1);
  });
});
