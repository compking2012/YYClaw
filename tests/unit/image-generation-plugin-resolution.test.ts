import { describe, expect, it } from 'vitest';
import {
  collectImageGenerationModelRefs,
  resolveRequiredClawXImagePluginIds,
  resolveRequiredClawXImagePlugins,
} from '@electron/gateway/image-generation-plugin-resolution';

describe('collectImageGenerationModelRefs', () => {
  it('collects the default primary and fallbacks', () => {
    const config = {
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: 'gptimage2-gptimage/gpt-image-2',
            fallbacks: ['minimax-portal/image-01'],
          },
        },
      },
    };

    expect(collectImageGenerationModelRefs(config)).toEqual([
      'gptimage2-gptimage/gpt-image-2',
      'minimax-portal/image-01',
    ]);
  });

  it('collects per-agent overrides in agents.list', () => {
    const config = {
      agents: {
        list: [
          { id: 'main', imageGenerationModel: 'gemini31flashimage-gemini31/gemini-3.1-flash-image' },
          { id: 'other' },
        ],
      },
    };

    expect(collectImageGenerationModelRefs(config)).toEqual([
      'gemini31flashimage-gemini31/gemini-3.1-flash-image',
    ]);
  });

  it('accepts a bare string slot', () => {
    const config = { agents: { defaults: { imageGenerationModel: 'gptimage2-gptimage/gpt-image-2' } } };
    expect(collectImageGenerationModelRefs(config)).toEqual(['gptimage2-gptimage/gpt-image-2']);
  });

  it('returns an empty list for missing or malformed config', () => {
    expect(collectImageGenerationModelRefs(undefined)).toEqual([]);
    expect(collectImageGenerationModelRefs({})).toEqual([]);
    expect(collectImageGenerationModelRefs({ agents: {} })).toEqual([]);
  });
});

describe('resolveRequiredClawXImagePluginIds', () => {
  function buildConfig(primary: string, providerKey: string, modelId: string) {
    return {
      agents: { defaults: { imageGenerationModel: { primary } } },
      models: { providers: { [providerKey]: { models: [{ id: modelId }] } } },
    };
  }

  it('requires clawx-openai-image for a gpt-image ref', () => {
    const config = buildConfig('gptimage2-gptimage/gpt-image-2', 'gptimage2-gptimage', 'gpt-image-2');
    expect(resolveRequiredClawXImagePluginIds(config)).toEqual(['clawx-openai-image']);
  });

  it('requires clawx-gemini-image for a gemini image ref', () => {
    const config = buildConfig(
      'gemini31flashimage-gemini31/gemini-3.1-flash-image',
      'gemini31flashimage-gemini31',
      'gemini-3.1-flash-image',
    );
    expect(resolveRequiredClawXImagePluginIds(config)).toEqual(['clawx-gemini-image']);
  });

  it('requires no plugin for a native provider id', () => {
    const config = buildConfig('minimax-portal/image-01', 'minimax-portal', 'image-01');
    expect(resolveRequiredClawXImagePluginIds(config)).toEqual([]);
  });

  it('requires no plugin for a model outside both ClawX families', () => {
    const config = buildConfig('someimagen-abc/imagen-4', 'someimagen-abc', 'imagen-4');
    expect(resolveRequiredClawXImagePluginIds(config)).toEqual([]);
  });

  it('requires no plugin when the ref names no models.providers entry', () => {
    const config = {
      agents: { defaults: { imageGenerationModel: { primary: 'ghost-key/gpt-image-2' } } },
      models: { providers: {} },
    };
    expect(resolveRequiredClawXImagePluginIds(config)).toEqual([]);
  });

  it('deduplicates and sorts plugin ids across multiple refs', () => {
    const config = {
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: 'gptimage2-gptimage/gpt-image-2',
            fallbacks: ['gptimage2-gptimage/gpt-image-1-mini'],
          },
        },
        list: [
          { id: 'main', imageGenerationModel: 'gemini31flashimage-gemini31/gemini-3.1-flash-image' },
        ],
      },
      models: {
        providers: {
          'gptimage2-gptimage': { models: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1-mini' }] },
          'gemini31flashimage-gemini31': { models: [{ id: 'gemini-3.1-flash-image' }] },
        },
      },
    };

    expect(resolveRequiredClawXImagePluginIds(config)).toEqual([
      'clawx-gemini-image',
      'clawx-openai-image',
    ]);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(resolveRequiredClawXImagePluginIds({})).toEqual([]);
  });
});

describe('resolveRequiredClawXImagePlugins (with backing provider keys)', () => {
  it('returns the backing provider keys alongside plugin ids', () => {
    const config = {
      agents: { defaults: { imageGenerationModel: { primary: 'gptimage2-gptimage/gpt-image-2' } } },
      models: { providers: { 'gptimage2-gptimage': { models: [{ id: 'gpt-image-2' }] } } },
    };

    expect(resolveRequiredClawXImagePlugins(config)).toEqual({
      pluginIds: ['clawx-openai-image'],
      providerKeys: ['gptimage2-gptimage'],
    });
  });

  it('does not include native or off-family provider keys', () => {
    const config = {
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: 'minimax-portal/image-01',
            fallbacks: ['someimagen-abc/imagen-4'],
          },
        },
      },
      models: {
        providers: {
          'minimax-portal': { models: [{ id: 'image-01' }] },
          'someimagen-abc': { models: [{ id: 'imagen-4' }] },
        },
      },
    };

    expect(resolveRequiredClawXImagePlugins(config)).toEqual({ pluginIds: [], providerKeys: [] });
  });
});
