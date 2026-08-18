import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostApi } from '@/lib/host-api';
import { toast } from '@/lib/toast';
import { useGatewayStore } from '@/stores/gateway';

export type ActionSchema =
  | { type: 'execute'; command: string; interceptOAuth?: boolean; onSuccess?: { if?: string; then?: ActionSchema } }
  | { type: 'set'; state: Record<string, any> }
  | { type: 'reload' };

export type LayoutNodeSchema =
  | { type: 'conditional'; condition: string; render: LayoutNodeSchema[] }
  | { type: 'input'; bind: string; label: string; inputType?: string }
  | { type: 'button'; label: string; action: string; variant?: 'primary' | 'outline' | 'default' | 'destructive' | 'secondary' | 'ghost' | 'link' }
  | { type: 'text'; content: string; className?: string };

export interface DynamicUISchema {
  version: string;
  state: Record<string, { type: string; source?: string; default?: any }>;
  onLoad?: ActionSchema[];
  layout: LayoutNodeSchema[];
  actions: Record<string, ActionSchema[]>;
}

interface DynamicRendererProps {
  schema: DynamicUISchema;
  skillKey: string;
  onReloadRequested?: () => void;
  skillConfig?: Record<string, any>;
}

export function DynamicRenderer({ schema, skillKey, onReloadRequested, skillConfig }: DynamicRendererProps) {
  const [state, setState] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  function evaluateCondition(condition: string, currentState: Record<string, any>) {
    try {
      // Basic substitution for condition eval.
      // Replacing $state.xyz with actual values
      let evalStr = condition;
      for (const key of Object.keys(currentState)) {
        const val = currentState[key];
        const replaceVal = typeof val === 'boolean' ? val : `"${val}"`;
        // Replace all instances of $state.key or {$state.key}
        evalStr = evalStr.replace(new RegExp(`\\$state\\.${key}`, 'g'), String(replaceVal));
      }
      evalStr = evalStr.replace(/!\s*true/g, 'false').replace(/!\s*false/g, 'true');
      evalStr = evalStr.replace(/!\s*"[^"]+"/g, 'false').replace(/!\s*""/g, 'true');

      // Simple eval without Function/eval for safety if possible, or use a restricted Function
      // Since it's a known schema, we use Function
      return new Function(`return ${evalStr}`)();
    } catch (e) {
      console.error('Condition eval failed', condition, e);
      return false;
    }
  }

  async function executeCommand(commandTpl: string, currentState: Record<string, any>, interceptOAuth?: boolean) {
    // Substitute variables like {$state.appId}
    let command = commandTpl;
    for (const key of Object.keys(currentState)) {
      command = command.replace(new RegExp(`\\{\\$state\\.${key}\\}`, 'g'), currentState[key] || '');
    }

    try {
      const result = await hostApi.skills.executeUiAction({
        command,
        interceptOAuth,
      });
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async function executeActions(actions: ActionSchema[], currentState: Record<string, any>) {
    let tempState = { ...currentState };
    for (const action of actions) {
      if (action.type === 'execute') {
        const result = await executeCommand(action.command, tempState, action.interceptOAuth);
        if (result && result.success) {
          if (action.onSuccess) {
            // Very simplified result checking
            // E.g. $result.user_access_token_present == true
            let conditionPassed = true;
            if (action.onSuccess.if) {
              try {
                let parsedResult = {};
                try {
                  parsedResult = JSON.parse(result.output || '{}');
                } catch {
                  // Malformed command output — keep empty result object.
                }
                let condStr = action.onSuccess.if;
                // Only simple string replace
                condStr = condStr.replace(/\$result\.(\w+)/g, (_match, p1) => {
                  return String((parsedResult as any)[p1] ?? 'null');
                });
                conditionPassed = new Function(`return ${condStr}`)();
              } catch {
                conditionPassed = false;
              }
            }
            if (conditionPassed && action.onSuccess.then) {
              await executeActions([action.onSuccess.then], tempState);
            }
          }
        } else {
          toast.appError(result?.error);
          break; // Stop on failure
        }
      } else if (action.type === 'set') {
        tempState = { ...tempState, ...action.state };
        setState(tempState);
      } else if (action.type === 'reload') {
        if (onReloadRequested) {
          onReloadRequested();
        }
        // Also re-run onLoad
        if (schema.onLoad) {
          await executeActions(schema.onLoad, tempState);
        }
      }
    }
  }

  // Initialize state based on schema
  useEffect(() => {
    let isMounted = true;

    const initState = async () => {
      const initialState: Record<string, any> = {};

      let systemConfig: Record<string, any> = {};
      try {
        systemConfig = await useGatewayStore.getState().rpc('system.config');
      } catch (e) {
        console.warn('Failed to fetch system config', e);
      }

      for (const [key, def] of Object.entries(schema.state)) {
        let val = def.default !== undefined ? def.default : '';

        if (def.source) {
          if (def.source.startsWith('channel:')) {
            const path = def.source.replace('channel:', 'channels.');
            const parts = path.split('.');
            let cur: any = systemConfig;
            for (const p of parts) {
              if (cur && typeof cur === 'object') {
                cur = cur[p];
              } else {
                cur = undefined;
                break;
              }
            }
            if (cur !== undefined) {
              val = cur;
            }
          } else if (skillConfig) {
            // Check top level first
            if (skillConfig[def.source] !== undefined) {
              val = skillConfig[def.source];
            } else if (skillConfig.env && skillConfig.env[def.source] !== undefined) {
              // Check env variables
              val = skillConfig.env[def.source];
            }
          }
        }

        initialState[key] = val;
      }

      if (isMounted) {
        setState(initialState);
        setLoading(false);
      }

      // Execute onLoad actions
      if (schema.onLoad && schema.onLoad.length > 0) {
        await executeActions(schema.onLoad, initialState);
      }
    };

    void initState();
    return () => { isMounted = false; };
    // Intentionally omit skillConfig: same as pre-refactor — avoid resetting local form /
    // re-running onLoad on every parent config object identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoad uses function declarations above
  }, [schema, skillKey]);

  const handleActionClick = async (actionName: string) => {
    const actions = schema.actions[actionName];
    if (!actions) return;

    // We might want to set a loading state here
    await executeActions(actions, state);
  };

  const renderNode = (node: LayoutNodeSchema, index: number) => {
    if (node.type === 'conditional') {
      if (!evaluateCondition(node.condition, state)) {
        return null;
      }
      return (
        <div key={`cond-${index}`} className="space-y-4">
          {node.render.map((child, i) => renderNode(child, i))}
        </div>
      );
    }

    if (node.type === 'input') {
      return (
        <div key={`input-${index}`} className="space-y-2">
          <Label>{node.label}</Label>
          <Input
            type={node.inputType || 'text'}
            value={state[node.bind] || ''}
            onChange={(e) => setState({ ...state, [node.bind]: e.target.value })}
            placeholder={node.label}
          />
        </div>
      );
    }

    if (node.type === 'button') {
      const v = node.variant === 'primary' ? 'default' : (node.variant || 'default');
      return (
        <Button key={`btn-${index}`} variant={v as any} onClick={() => handleActionClick(node.action)}>
          {node.label}
        </Button>
      );
    }

    if (node.type === 'text') {
      return (
        <div key={`text-${index}`} className={node.className}>
          {node.content}
        </div>
      );
    }

    return null;
  };

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading UI Schema...</div>;
  }

  return (
    <div className="space-y-6">
      {schema.layout.map((node, i) => renderNode(node, i))}
    </div>
  );
}
