import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settings';

/** Below this width (non-fullscreen), auto-collapse main sidebar on Office page. */
export const OFFICE_COMPACT_MAX_WIDTH = 1180;
/** Below this height (non-fullscreen), same compact chrome. */
export const OFFICE_COMPACT_MAX_HEIGHT = 780;

export function isOfficeCompactViewport(): boolean {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    return false;
  }
  return (
    window.innerWidth < OFFICE_COMPACT_MAX_WIDTH ||
    window.innerHeight < OFFICE_COMPACT_MAX_HEIGHT
  );
}

/**
 * On compact viewports: collapse main sidebar on Office page.
 * Restores prior sidebar state when viewport expands or enters fullscreen.
 */
export function useOfficeViewportChrome() {
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const savedSidebarRef = useRef<boolean | null>(null);
  const autoActiveRef = useRef(false);

  useEffect(() => {
    const apply = () => {
      const compact = isOfficeCompactViewport();

      if (compact) {
        if (!autoActiveRef.current) {
          const { sidebarCollapsed } = useSettingsStore.getState();
          savedSidebarRef.current = sidebarCollapsed;
          autoActiveRef.current = true;
          if (!sidebarCollapsed) {
            setSidebarCollapsed(true);
          }
        }
        return;
      }

      if (autoActiveRef.current) {
        const saved = savedSidebarRef.current;
        if (saved !== null) {
          setSidebarCollapsed(saved);
        }
        savedSidebarRef.current = null;
        autoActiveRef.current = false;
      }
    };

    apply();
    window.addEventListener('resize', apply);
    document.addEventListener('fullscreenchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.removeEventListener('fullscreenchange', apply);
      if (autoActiveRef.current && savedSidebarRef.current !== null) {
        setSidebarCollapsed(savedSidebarRef.current);
      }
      autoActiveRef.current = false;
      savedSidebarRef.current = null;
    };
  }, [setSidebarCollapsed]);
}
