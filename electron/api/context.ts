import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from './event-bus';
import type { WorkflowEngine } from '../workflow/engine';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
  workflowEngine: WorkflowEngine;
}
