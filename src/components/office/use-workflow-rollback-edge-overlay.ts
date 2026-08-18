import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeWorkflowRollbackEdgePaths,
  type WorkflowRollbackEdgePath,
} from '@/lib/office-workflow-visual-rollback-path';
import type { WorkflowDefinition } from '@/types/office';

export function useWorkflowRollbackEdgeOverlay(workflow: WorkflowDefinition) {
  const markerId = useId().replace(/:/g, '');
  const rollbackEdges = useMemo(
    () => workflow.edges.filter((e) => (e.when ?? 'on_success') === 'on_failure'),
    [workflow.edges],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [rollbackPaths, setRollbackPaths] = useState<WorkflowRollbackEdgePath[]>([]);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  const setNodeRef = useCallback((nodeId: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(nodeId, el);
    else nodeRefs.current.delete(nodeId);
  }, []);

  const refreshRollbackPaths = useCallback(() => {
    const container = containerRef.current;
    if (!container || rollbackEdges.length === 0) {
      setRollbackPaths((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    setOverlaySize((prev) => {
      const next = { width: container.offsetWidth, height: container.offsetHeight };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    const nextPaths = computeWorkflowRollbackEdgePaths(rollbackEdges, nodeRefs.current, container);
    setRollbackPaths((prev) => {
      if (prev.length !== nextPaths.length) return nextPaths;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i]?.id !== nextPaths[i]?.id || prev[i]?.d !== nextPaths[i]?.d) return nextPaths;
      }
      return prev;
    });
  }, [rollbackEdges]);

  useLayoutEffect(() => {
    // Measure DOM geometry for rollback edge overlay; layout effect is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync SVG paths to node boxes
    refreshRollbackPaths();
    const container = containerRef.current;
    if (!container) return undefined;

    const ro = new ResizeObserver(() => refreshRollbackPaths());
    ro.observe(container);
    window.addEventListener('resize', refreshRollbackPaths);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refreshRollbackPaths);
    };
  }, [refreshRollbackPaths]);

  return {
    markerId,
    rollbackEdges,
    containerRef,
    setNodeRef,
    rollbackPaths,
    overlaySize,
  };
}
