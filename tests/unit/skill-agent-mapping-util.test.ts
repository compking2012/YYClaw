import { describe, expect, it } from 'vitest';
import type { AgentSummary } from '@/types/agent';
import {
  buildSkillAgentsMap,
  enhanceSkillsWithAgentAssignments,
} from '@electron/utils/skill-agent-mapping';

const baseAgent = (overrides: Partial<AgentSummary>): AgentSummary => ({
  id: 'main',
  name: 'Main',
  isDefault: true,
  skills: [],
  modelDisplay: '',
  modelRef: null,
  overrideModelRef: null,
  overrideImageModelRef: null,
  overrideImageGenerationModelRef: null,
  overrideVideoGenerationModelRef: null,
  overrideMusicGenerationModelRef: null,
  inheritedModel: false,
  workspace: '/workspace',
  agentDir: '/agent',
  mainSessionKey: 'main',
  channelTypes: [],
  ...overrides,
});

describe('skill-agent mapping util', () => {
  it('marks scanned skills enabled when assigned to agents', () => {
    const agents = [baseAgent({ skills: ['feishu-update-doc'] })];
    const skills = [{
      id: 'feishu-update-doc',
      name: 'feishu-update-doc',
      description: 'update feishu doc',
      enabled: false,
      source: 'openclaw-plugin',
    }];

    const enhanced = enhanceSkillsWithAgentAssignments(skills, agents);

    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]).toMatchObject({
      id: 'feishu-update-doc',
      agents: ['main'],
      enabled: true,
    });
  });

  it('resolves agent-assigned folder slug to scanned skill id', () => {
    const agents = [baseAgent({ skills: ['self-improving-agent'] })];
    const skills = [{
      id: 'self-improvement',
      slug: 'self-improving-agent',
      name: 'self-improvement',
      description: 'learns from mistakes',
      enabled: false,
      source: 'openclaw-managed',
      baseDir: '/tmp/self-improving-agent',
    }];

    const enhanced = enhanceSkillsWithAgentAssignments(skills, agents);

    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]).toMatchObject({
      id: 'self-improvement',
      agents: ['main'],
      enabled: true,
      source: 'openclaw-managed',
    });
  });

  it('adds agent-assigned skills missing from disk scan', () => {
    const agents = [baseAgent({ skills: ['feishu-update-doc'] })];
    const enhanced = enhanceSkillsWithAgentAssignments([], agents);

    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]).toMatchObject({
      id: 'feishu-update-doc',
      agents: ['main'],
      enabled: true,
      source: 'agent-assignment',
    });
  });

  it('marks global defaults enabled even without agent assignments', () => {
    const agents = [baseAgent({ skills: [] })];
    const skills = [{
      id: 'find-skills',
      name: 'find-skills',
      description: 'find',
      enabled: false,
      source: 'openclaw-managed',
    }];

    const enhanced = enhanceSkillsWithAgentAssignments(skills, agents, new Set(['find-skills']));

    expect(enhanced[0]).toMatchObject({
      id: 'find-skills',
      agents: [],
      enabled: true,
    });
  });

  it('builds normalized skill -> agents map', () => {
    const agents = [
      baseAgent({ id: 'main', skills: ['Feishu-Update-Doc'] }),
      baseAgent({ id: 'coding', skills: ['web-search'] }),
    ];
    const map = buildSkillAgentsMap(agents);

    expect(map.get('feishu-update-doc')).toEqual(['main']);
    expect(map.get('web-search')).toEqual(['coding']);
  });
});
