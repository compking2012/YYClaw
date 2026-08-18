import type { OfficeTempProject } from '@/types/office';
import {
  deriveWorkflowExecutionPhase,
  isWorkflowReviewActive,
} from '@/lib/office-workflow-user-checkpoint';

/** 项目或任一步骤处于执行中（不含仅 status=running 的审查等待）。 */
function isProjectExecuting(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns'>,
): boolean {
  return project.nodeRuns.some((nr) => nr.status === 'running');
}

function reviewStatusLight(
  project: Pick<OfficeTempProject, 'workflowReviewBatch' | 'status' | 'nodeRuns'>,
): OfficeProjectLight | null {
  if (!isWorkflowReviewActive(project)) return null;
  const phase = deriveWorkflowExecutionPhase(project);
  if (phase === 'collecting' || phase === 'awaiting_review') {
    return 'awaiting_review';
  }
  if (phase === 'deferred_review' && !isProjectExecuting(project)) {
    return 'awaiting_review';
  }
  return null;
}

function isProjectArchived(project: Pick<OfficeTempProject, 'lifecycle'>): boolean {
  return (project.lifecycle ?? 'active') !== 'active';
}

/** 项目/固定组状态灯：灰=待执行、绿=执行中、黄=已中止、蓝=已完成；失败仍用红。 */
export type OfficeProjectLight =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'aborted'
  | 'completed'
  | 'failed'
  | 'blocked';

export type OfficeProjectStatusDotStyle = {
  dotClass: string;
  pingClass?: string;
  pulse?: boolean;
};

export function officeProjectStatusLight(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns' | 'workflowReviewBatch'>,
): OfficeProjectLight {
  const reviewLight = reviewStatusLight(project);
  if (reviewLight) return reviewLight;
  if (isProjectExecuting(project)) return 'running';
  if (project.status === 'running') return 'running';
  if (project.status === 'completed') return 'completed';
  if (project.status === 'aborted') return 'aborted';
  if (project.status === 'failed') return 'failed';
  if (project.status === 'blocked') return 'blocked';
  return 'pending';
}

/** 固定组状态灯：由其下活跃派出项目聚合；无活跃派出项目时返回 null（不显示灯）。 */
export function officeFixedGroupStatusLight(
  groupId: string,
  projects: Pick<
    OfficeTempProject,
    'parentGroupId' | 'origin' | 'lifecycle' | 'status' | 'nodeRuns' | 'workflowReviewBatch'
  >[],
): OfficeProjectLight | null {
  const active = projects.filter(
    (p) =>
      p.origin === 'fixed_group'
      && p.parentGroupId === groupId
      && !isProjectArchived(p),
  );
  if (active.length === 0) return null;

  const lights = active.map((p) => officeProjectStatusLight(p));
  if (lights.some((l) => l === 'running')) return 'running';
  if (lights.some((l) => l === 'awaiting_review')) return 'awaiting_review';
  if (lights.some((l) => l === 'failed')) return 'failed';
  if (lights.some((l) => l === 'aborted' || l === 'blocked')) return 'aborted';
  if (lights.every((l) => l === 'completed')) return 'completed';
  return 'pending';
}

export function officeProjectStatusLightDotStyle(
  light: OfficeProjectLight,
): OfficeProjectStatusDotStyle {
  switch (light) {
    case 'running':
      return {
        dotClass: 'bg-emerald-500',
        pingClass: 'bg-emerald-400',
        pulse: true,
      };
    case 'awaiting_review':
      return {
        dotClass: 'bg-violet-500',
        pingClass: 'bg-violet-400',
        pulse: true,
      };
    case 'completed':
      return { dotClass: 'bg-sky-500' };
    case 'aborted':
    case 'blocked':
      return { dotClass: 'bg-amber-400' };
    case 'failed':
      return { dotClass: 'bg-red-500' };
    case 'pending':
    default:
      return { dotClass: 'bg-muted-foreground/45' };
  }
}

/**
 * Inline border/background colors for a status light — used to tint group-chat message bubbles
 * so each agent's message matches the project card's per-role task progress color.
 * Hex values mirror the dot palette (emerald/sky/violet/amber/red + neutral gray for pending).
 */
export function officeProjectStatusLightBubbleStyle(
  light: OfficeProjectLight,
): { backgroundColor: string; borderColor: string } {
  const hex = (() => {
    switch (light) {
      case 'running':
        return '#10b981'; // emerald-500
      case 'completed':
        return '#0ea5e9'; // sky-500
      case 'awaiting_review':
        return '#8b5cf6'; // violet-500
      case 'aborted':
      case 'blocked':
        return '#fbbf24'; // amber-400
      case 'failed':
        return '#ef4444'; // red-500
      case 'pending':
      default:
        return '#94a3b8'; // slate-400 (neutral)
    }
  })();
  return { backgroundColor: `${hex}1a`, borderColor: `${hex}55` };
}

export function officeProjectStatusLightCardRingClass(light: OfficeProjectLight): string | null {
  switch (light) {
    case 'running':
      return 'border-emerald-500/35 ring-1 ring-emerald-500/15';
    case 'awaiting_review':
      return 'border-violet-500/35 ring-1 ring-violet-500/15';
    case 'completed':
      return 'border-sky-500/35 ring-1 ring-sky-500/15';
    case 'aborted':
    case 'blocked':
      return 'border-amber-400/40 ring-1 ring-amber-400/15';
    case 'failed':
      return 'border-red-500/35 ring-1 ring-red-500/15';
    default:
      return null;
  }
}
