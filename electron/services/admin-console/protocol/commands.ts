export type AdminConsoleCommandName =
  | 'get_config'
  | 'get_stats_all'
  | 'get_stats_models'
  | 'get_agent_activity'
  | 'get_sessions'
  | 'get_gateway_health'
  | 'get_skills'
  | 'get_skill_content'
  | 'install_skill'
  | 'get_pixel_office_tracks'
  | 'debug_test_agents'
  | 'debug_test_platforms'
  | 'debug_test_sessions'
  | 'debug_test_dm_sessions'
  | 'debug_test_model'
  | 'debug_test_session'
  | 'request_log_upload'
  | 'update_settings';

export interface AdminConsoleCommand {
  id?: string;
  command: AdminConsoleCommandName;
  payload?: Record<string, unknown>;
}

export interface AdminConsoleResponseEnvelope {
  requestId?: string;
  command: AdminConsoleCommandName;
  sentAt: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}
