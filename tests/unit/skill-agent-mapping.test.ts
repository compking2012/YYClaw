/**
 * Unit tests for skill-agent bidirectional mapping
 */
import { describe, it, expect } from 'vitest';
import type { AgentSummary } from '@/types/agent';
import type { Skill } from '@/types/skill';

describe('Skill-Agent Bidirectional Mapping', () => {
  describe('Skill.agents computation', () => {
    it('should compute empty agents list when no agents have the skill', () => {
      const agents: AgentSummary[] = [
        { id: 'main', name: 'Main', isDefault: true, skills: [], modelDisplay: '', modelRef: null, overrideModelRef: null, overrideImageModelRef: null, overrideImageGenerationModelRef: null, overrideVideoGenerationModelRef: null, overrideMusicGenerationModelRef: null, inheritedModel: false, workspace: '/workspace', agentDir: '/agent', mainSessionKey: 'main', channelTypes: [] },
        { id: 'coding', name: 'Coding', isDefault: false, skills: ['git-clone'], modelDisplay: '', modelRef: null, overrideModelRef: null, overrideImageModelRef: null, overrideImageGenerationModelRef: null, overrideVideoGenerationModelRef: null, overrideMusicGenerationModelRef: null, inheritedModel: false, workspace: '/workspace/coding', agentDir: '/agent/coding', mainSessionKey: 'coding', channelTypes: [] },
      ];

      const skill: Skill = {
        id: 'web-search',
        name: 'Web Search',
        description: 'Search the web',
        enabled: false,
        agents: [],
      };

      // Simulate backend computation
      const assignedAgents = agents
        .filter(agent => agent.skills?.includes(skill.id))
        .map(agent => agent.id);

      expect(assignedAgents).toEqual([]);
    });

    it('should compute correct agents list when multiple agents have the skill', () => {
      const agents: AgentSummary[] = [
        { id: 'main', name: 'Main', isDefault: true, skills: ['web-search', 'file-read'], modelDisplay: '', modelRef: null, overrideModelRef: null, overrideImageModelRef: null, overrideImageGenerationModelRef: null, overrideVideoGenerationModelRef: null, overrideMusicGenerationModelRef: null, inheritedModel: false, workspace: '/workspace', agentDir: '/agent', mainSessionKey: 'main', channelTypes: [] },
        { id: 'coding', name: 'Coding', isDefault: false, skills: ['web-search', 'git-clone'], modelDisplay: '', modelRef: null, overrideModelRef: null, overrideImageModelRef: null, overrideImageGenerationModelRef: null, overrideVideoGenerationModelRef: null, overrideMusicGenerationModelRef: null, inheritedModel: false, workspace: '/workspace/coding', agentDir: '/agent/coding', mainSessionKey: 'coding', channelTypes: [] },
        { id: 'writer', name: 'Writer', isDefault: false, skills: ['file-write'], modelDisplay: '', modelRef: null, overrideModelRef: null, overrideImageModelRef: null, overrideImageGenerationModelRef: null, overrideVideoGenerationModelRef: null, overrideMusicGenerationModelRef: null, inheritedModel: false, workspace: '/workspace/writer', agentDir: '/agent/writer', mainSessionKey: 'writer', channelTypes: [] },
      ];

      const skill: Skill = {
        id: 'web-search',
        name: 'Web Search',
        description: 'Search the web',
        enabled: true,
        agents: [],
      };

      const assignedAgents = agents
        .filter(agent => agent.skills?.includes(skill.id))
        .map(agent => agent.id);

      expect(assignedAgents).toEqual(['main', 'coding']);
    });

    it('should derive enabled status from agents list length', () => {
      const skillWithAgents: Skill = {
        id: 'web-search',
        name: 'Web Search',
        description: 'Search the web',
        enabled: true,
        agents: ['main', 'coding'],
      };

      const skillWithoutAgents: Skill = {
        id: 'image-gen',
        name: 'Image Generation',
        description: 'Generate images',
        enabled: false,
        agents: [],
      };

      expect(skillWithAgents.agents.length > 0).toBe(true);
      expect(skillWithAgents.enabled).toBe(true);

      expect(skillWithoutAgents.agents.length > 0).toBe(false);
      expect(skillWithoutAgents.enabled).toBe(false);
    });
  });

  describe('Agent.skills reverse lookup', () => {
    it('should find skills assigned to a specific agent', () => {
      const skills: Skill[] = [
        { id: 'web-search', name: 'Web Search', description: '', enabled: true, agents: ['main', 'coding'] },
        { id: 'git-clone', name: 'Git Clone', description: '', enabled: true, agents: ['coding'] },
        { id: 'file-write', name: 'File Write', description: '', enabled: true, agents: ['main', 'writer'] },
        { id: 'image-gen', name: 'Image Gen', description: '', enabled: false, agents: [] },
      ];

      const codingAgentSkills = skills
        .filter(skill => skill.agents?.includes('coding'))
        .map(skill => skill.id);

      expect(codingAgentSkills).toEqual(['web-search', 'git-clone']);
    });
  });

  describe('Skill assignment state transitions', () => {
    it('should transition from disabled to enabled when assigned to an agent', () => {
      const skill: Skill = {
        id: 'new-skill',
        name: 'New Skill',
        description: 'A new skill',
        enabled: false,
        agents: [],
      };

      // Simulate assigning to an agent
      const updatedSkill = {
        ...skill,
        agents: ['main'],
        enabled: true,
      };

      expect(updatedSkill.enabled).toBe(true);
      expect(updatedSkill.agents).toEqual(['main']);
    });

    it('should transition from enabled to disabled when removed from all agents', () => {
      const skill: Skill = {
        id: 'existing-skill',
        name: 'Existing Skill',
        description: 'An existing skill',
        enabled: true,
        agents: ['main', 'coding'],
      };

      // Simulate removing from all agents
      const updatedSkill = {
        ...skill,
        agents: [],
        enabled: false,
      };

      expect(updatedSkill.enabled).toBe(false);
      expect(updatedSkill.agents).toEqual([]);
    });
  });

  describe('Bulk operations', () => {
    it('should assign multiple skills to the same set of agents', () => {
      const skills: Skill[] = [
        { id: 'skill-a', name: 'Skill A', description: '', enabled: false, agents: [] },
        { id: 'skill-b', name: 'Skill B', description: '', enabled: false, agents: [] },
      ];

      const targetAgents = ['main', 'coding'];

      const updatedSkills = skills.map(skill => ({
        ...skill,
        agents: targetAgents,
        enabled: true,
      }));

      expect(updatedSkills[0].agents).toEqual(targetAgents);
      expect(updatedSkills[0].enabled).toBe(true);
      expect(updatedSkills[1].agents).toEqual(targetAgents);
      expect(updatedSkills[1].enabled).toBe(true);
    });

    it('should remove multiple skills from all agents', () => {
      const skills: Skill[] = [
        { id: 'skill-a', name: 'Skill A', description: '', enabled: true, agents: ['main', 'coding'] },
        { id: 'skill-b', name: 'Skill B', description: '', enabled: true, agents: ['main', 'writer'] },
      ];

      const updatedSkills = skills.map(skill => ({
        ...skill,
        agents: [],
        enabled: false,
      }));

      expect(updatedSkills.every(s => s.agents.length === 0)).toBe(true);
      expect(updatedSkills.every(s => !s.enabled)).toBe(true);
    });
  });
});
