import type { Centrifuge } from 'centrifuge';
import { proxyAwareFetch } from '../../../utils/proxy-fetch';
import type { GatewayManager } from '../../../gateway/manager';
import type { ClawHubService } from '../../../gateway/clawhub';
import {
  collectAgentActivity,
  collectConfigSnapshot,
  collectGatewayHealth,
  collectLogsForUpload,
  collectPixelOfficeTracks,
  collectSessions,
  collectSkillContent,
  collectSkills,
  collectStatsAll,
  collectStatsModels,
} from '../collectors';
import type { AdminConsoleCommand, AdminConsoleResponseEnvelope } from './commands';
import { AdminConsoleTopics } from './topics';

function responseEnvelope(params: {
  command: AdminConsoleCommand['command'];
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}): AdminConsoleResponseEnvelope {
  return {
    requestId: params.requestId,
    command: params.command,
    sentAt: new Date().toISOString(),
    ok: params.ok,
    data: params.data,
    error: params.error,
  };
}

async function resolveCommandData(cmd: AdminConsoleCommand): Promise<unknown> {
  switch (cmd.command) {
    case 'get_config':
      return await collectConfigSnapshot();
    case 'get_stats_all':
      return await collectStatsAll();
    case 'get_stats_models':
      return await collectStatsModels();
    case 'get_agent_activity':
      return await collectAgentActivity();
    case 'get_sessions':
      return await collectSessions(String(cmd.payload?.agentId || 'main'));
    case 'get_gateway_health':
      return await collectGatewayHealth();
    case 'get_skills':
      return await collectSkills();
    case 'get_skill_content':
      return await collectSkillContent((cmd.payload || {}) as Record<string, unknown>);
    case 'get_pixel_office_tracks':
      return await collectPixelOfficeTracks();
    case 'debug_test_agents':
      return { accepted: true, debug: true, command: cmd.command };
    case 'debug_test_platforms':
      return { accepted: true, debug: true, command: cmd.command };
    case 'debug_test_sessions':
      return { accepted: true, debug: true, command: cmd.command };
    case 'debug_test_dm_sessions':
      return { accepted: true, debug: true, command: cmd.command };
    case 'debug_test_model':
      return { accepted: true, debug: true, command: cmd.command };
    case 'debug_test_session':
      return { accepted: true, debug: true, command: cmd.command };
    default:
      return null;
  }
}

export async function handleAdminConsoleCommand(params: {
  centrifuge: Centrifuge;
  machineId: string;
  command: AdminConsoleCommand;
  baseUrl: string;
  gatewayManager?: GatewayManager | null;
  clawHubService?: ClawHubService | null;
}): Promise<void> {
  const { centrifuge, machineId, command, baseUrl, gatewayManager, clawHubService } = params;
  const responseTopic = AdminConsoleTopics.response(machineId);

  try {
    if (command.command === 'install_skill') {
      if (!clawHubService) {
        throw new Error('ClawHub service is not available to install skill');
      }
      const payload = (command.payload || {}) as Record<string, unknown>;
      // For compatibility: manager backend passes slug/target_name, ClawHubService expects slug/version.
      // E.g. target_name in Manager might be mapped to slug in ClawHub.
      const installParams: Record<string, unknown> = { ...payload };
      if (payload.target_name && !payload.slug) {
        installParams.slug = payload.target_name;
      }
      
      if (typeof installParams.slug !== 'string' || !installParams.slug.trim()) {
        throw new Error('install_skill payload missing slug');
      }
      await clawHubService.install(installParams as { slug: string; version?: string; force?: boolean });
      
      // Automatically enable skill after installation
      const slugOrName = installParams.slug || installParams.name;
      if (slugOrName && typeof slugOrName === 'string' && gatewayManager) {
        try {
          await gatewayManager.rpc(
            'skills.config.update',
            { skillKey: slugOrName, config: { enabled: true } },
            12000,
          );
        } catch (e) {
          console.error(`Failed to auto-enable skill ${slugOrName} after installation`, e);
        }
      }

      await centrifuge.publish(
        responseTopic,
        responseEnvelope({
          command: command.command,
          requestId: command.id,
          ok: true,
          data: { status: 'success' },
        }),
      );
      return;
    }

    if (command.command === 'request_log_upload') {
      const logPayload = await collectLogsForUpload();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const uploadResp = await proxyAwareFetch(`${baseUrl}/api/logs/upload`, {
        method: 'POST',
        headers,
        body: JSON.stringify(logPayload),
      });
      await centrifuge.publish(
        responseTopic,
        responseEnvelope({
          command: command.command,
          requestId: command.id,
          ok: uploadResp.ok,
          data: { status: uploadResp.status },
          error: uploadResp.ok ? undefined : `Upload failed: ${uploadResp.status}`,
        }),
      );
      return;
    }

    const data = await resolveCommandData(command);
    await centrifuge.publish(
      responseTopic,
      responseEnvelope({
        command: command.command,
        requestId: command.id,
        ok: true,
        data,
      }),
    );
  } catch (error) {
    await centrifuge.publish(
      responseTopic,
      responseEnvelope({
        command: command.command,
        requestId: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
