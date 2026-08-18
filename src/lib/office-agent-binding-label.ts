import type { TFunction } from 'i18next';
import type { AgentBindingRecord } from '@/types/office';

export function formatAgentBindingLabel(
  record: AgentBindingRecord,
  t: TFunction<'office'>,
): string {
  if (record.kind === 'fixed_group') {
    return t('agentPool.boundToFixedGroup', { name: record.entityName });
  }
  return t('agentPool.boundToTempProject', { name: record.entityName });
}

export function isAgentBoundElsewhere(
  agentId: string,
  bindings: Record<string, AgentBindingRecord> | undefined,
  scope?: { entityId: string },
): boolean {
  const record = bindings?.[agentId];
  if (!record) return false;
  if (scope && record.entityId === scope.entityId) return false;
  return true;
}
