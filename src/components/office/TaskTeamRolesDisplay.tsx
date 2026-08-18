import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { projectMembersFromIds } from '@/lib/office-project-members';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';

interface TaskTeamAgentsDisplayProps {
  agentIds: string[];
  coordinatorAgentId: string;
  agents: AgentSummary[];
}

export function TaskTeamAgentsDisplay({
  agentIds,
  coordinatorAgentId,
  agents,
}: TaskTeamAgentsDisplayProps) {
  const { t } = useTranslation('office');
  const lookup = (id: string) => agents.find((a) => a.id === id)?.name;
  const members = projectMembersFromIds(agentIds, lookup);

  if (members.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="office-task-team-agents">
      <div className="space-y-1">
        <Label>{t('taskForm.teamMembers')}</Label>
        <p className="text-xs text-muted-foreground">{t('taskForm.teamMembersHint')}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((member) => {
          const isCoordinator = member.agentId === coordinatorAgentId;
          return (
            <span
              key={member.agentId}
              data-testid={`office-task-team-agent-${member.agentId}`}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]',
                isCoordinator
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/50 bg-muted/40 text-foreground',
              )}
            >
              <span className="truncate font-medium">{member.displayName}</span>
              {isCoordinator ? (
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  ·{t('agentPool.coordinatorShort')}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** @deprecated Use TaskTeamAgentsDisplay */
export function TaskTeamRolesDisplay(props: {
  teamRoleIds: string[];
  coordinatorRoleId: string;
  roles: never[];
}) {
  void props;
  return null;
}
