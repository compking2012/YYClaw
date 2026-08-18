import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar" />,
}));

vi.mock('@/components/web-browser/WebBrowserHost', () => ({
  WebBrowserHost: () => <div data-testid="web-browser-host" />,
}));

const renderLayout = (initialRoute = '/') =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <MainLayout />
    </MemoryRouter>,
  );

describe('MainLayout platform layout', () => {
  it('renders a top drag strip over content on macOS', () => {
    window.electron.platform = 'darwin';

    renderLayout();

    // On macOS the shell is a horizontal row (sidebar + content); the drag strip
    // is layered over the top of the content area rather than a top TitleBar.
    expect(screen.getByTestId('main-layout')).toHaveClass('flex-row');
    expect(screen.getByTestId('main-content')).toHaveClass('relative');
    // macOS gets an inset drag region layered over the top of the content area.
    expect(screen.getByTestId('mac-main-drag-region')).toHaveClass('drag-region');
  });

  it('omits the macOS drag strip on Windows', () => {
    window.electron.platform = 'win32';

    renderLayout();

    const layout = screen.getByTestId('main-layout');
    expect(layout).toHaveClass('flex-col');
    expect(screen.queryByTestId('mac-main-drag-region')).not.toBeInTheDocument();
  });

  it('mounts one global web browser host beside routed main content', () => {
    render(<MainLayout />);

    const main = screen.getByTestId('main-content');
    const host = screen.getByTestId('web-browser-host');
    expect(screen.getAllByTestId('web-browser-host')).toHaveLength(1);
    expect(main).not.toContainElement(host);
    expect(main.parentElement).toBe(host.parentElement);
  });
});
