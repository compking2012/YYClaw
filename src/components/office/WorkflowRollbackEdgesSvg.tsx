import type { WorkflowRollbackEdgePath } from '@/lib/office-workflow-visual-rollback-path';

type WorkflowRollbackEdgesSvgProps = {
  paths: WorkflowRollbackEdgePath[];
  width: number;
  height: number;
  markerId: string;
};

export function WorkflowRollbackEdgesSvg({
  paths,
  width,
  height,
  markerId,
}: WorkflowRollbackEdgesSvgProps) {
  if (paths.length === 0 || width <= 0) return null;

  const markerUrl = `url(#${markerId})`;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      width={width}
      height={height}
      aria-hidden
      data-testid="office-workflow-rollback-edges"
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-red-500" />
        </marker>
      </defs>
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill="none"
          stroke="rgb(239 68 68)"
          strokeWidth={2}
          strokeDasharray="6 4"
          markerEnd={markerUrl}
          opacity={0.92}
        />
      ))}
    </svg>
  );
}
