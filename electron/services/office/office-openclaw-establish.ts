/**
 * @deprecated Office lifecycle must not write openclaw.json. Runtime dispatches
 * carry an Office-scoped tool policy, and project workspaces are managed by
 * Office project manifests instead of agents.list[].workspace.
 */
export async function establishOfficeAgentsInOpenClaw(_agentIds: string[]): Promise<void> {
  return undefined;
}
