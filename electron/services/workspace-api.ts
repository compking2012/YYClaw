import { readdir, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { listAgentsSnapshot } from '../utils/agent-config';
import { clearWorkspaceAttestation, ensureClawXIdentityFile, resetWorkspaceSetupCompletion, seedWorkspaceBootstrapFiles } from '../utils/openclaw-workspace';
import type { WorkspaceFileTreeNode } from '@shared/host-api/contract';

function expandWorkspacePath(value: string): string {
  return value.startsWith('~') ? value.replace('~', homedir()) : value;
}

function isPathWithinRoot(root: string, requestedPath: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, requestedPath);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
}

async function buildFileTree(
  dirPath: string,
  rootPath: string,
  depth = 0,
  maxDepth = 10,
  includeHidden = false,
): Promise<WorkspaceFileTreeNode[]> {
  if (depth >= maxDepth) return [];
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: WorkspaceFileTreeNode[] = [];
  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
    const fullPath = join(dirPath, entry.name);
    const relativePath = relative(rootPath, fullPath);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await buildFileTree(fullPath, rootPath, depth + 1, maxDepth, includeHidden),
      });
    } else {
      nodes.push({ name: entry.name, path: relativePath, type: 'file' });
    }
  }
  return nodes;
}

export function createWorkspaceApi(): CompleteHostServiceRegistry['workspace'] {
  return {
    agents: async () => {
      const snapshot = await listAgentsSnapshot();
      return {
        success: true,
        agents: snapshot.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          workspace: expandWorkspacePath(agent.workspace),
          isDefault: agent.isDefault,
        })),
      };
    },
    tree: async (payload) => {
      const agentId = payload?.agentId || 'main';
      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((item) => item.id === agentId);
      if (!agent) return { success: false, error: `Agent "${agentId}" not found` };
      const workspace = expandWorkspacePath(agent.workspace);
      return {
        success: true,
        agentId: agent.id,
        agentName: agent.name,
        workspace,
        tree: await buildFileTree(workspace, workspace, 0, 10, payload?.includeHidden === true),
      };
    },
    rebuild: async (payload) => {
      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((item) => item.id === payload.agentId);
      if (!agent) return { success: false, error: `Agent "${payload.agentId}" not found` };
      const workspace = expandWorkspacePath(agent.workspace);
      // ClawX deletes BOOTSTRAP.md after the gateway seeds a workspace, which
      // trips OpenClaw's "workspace vanished" guard on re-setup. A rebuild is an
      // explicit reset, so clear the attestation first. Clearing the
      // setup-completed marker also lets setup re-seed the optional bootstrap
      // files (IDENTITY.md, USER.md, …) instead of only AGENTS.md / TOOLS.md.
      await clearWorkspaceAttestation(workspace);
      await resetWorkspaceSetupCompletion(workspace);
      await seedWorkspaceBootstrapFiles(workspace);
      // Restore ClawX's expected workspace shape: re-merge the ClawX identity
      // sections and drop the chat-first BOOTSTRAP.md that setup may re-create.
      await ensureClawXIdentityFile(workspace);
      await rm(join(workspace, 'BOOTSTRAP.md'), { force: true });
      return { success: true };
    },
    deleteFile: async (payload) => {
      const agentId = payload?.agentId || 'main';
      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((item) => item.id === agentId);
      if (!agent) return { success: false, error: `Agent "${agentId}" not found` };
      const workspace = expandWorkspacePath(agent.workspace);
      if (!isPathWithinRoot(workspace, payload.path)) {
        return { success: false, error: 'Path traversal not allowed' };
      }
      await rm(join(workspace, payload.path), { recursive: true, force: true });
      return { success: true };
    },
  };
}
