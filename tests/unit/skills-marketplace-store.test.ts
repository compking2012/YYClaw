import { beforeEach, describe, expect, it, vi } from 'vitest';

const marketplaceListMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      marketplaceList: (...args: unknown[]) => marketplaceListMock(...args),
    },
  },
}));

describe('skills marketplace store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('fetchMarketplaceSkills stores results for empty query', async () => {
    marketplaceListMock.mockResolvedValueOnce({
      success: true,
      results: [
        { slug: 'a', name: 'A', description: 'd', version: '1.0.0' },
      ],
    });

    const { useSkillsMarketplaceStore } = await import('@/stores/skills-marketplace');
    await useSkillsMarketplaceStore.getState().fetchMarketplaceSkills('');

    expect(useSkillsMarketplaceStore.getState().marketplaceResults).toHaveLength(1);
    expect(useSkillsMarketplaceStore.getState().marketplaceResults[0].slug).toBe('a');
    expect(useSkillsMarketplaceStore.getState().marketplaceError).toBeNull();
    expect(useSkillsMarketplaceStore.getState().marketplaceLoading).toBe(false);
    expect(marketplaceListMock).toHaveBeenCalledWith({ query: '', limit: 50, category: undefined });
  });

  it('passes category filter to marketplace list', async () => {
    marketplaceListMock.mockResolvedValueOnce({
      success: true,
      results: [],
    });

    const { useSkillsMarketplaceStore } = await import('@/stores/skills-marketplace');
    await useSkillsMarketplaceStore.getState().fetchMarketplaceSkills('', 'software-rd');

    expect(marketplaceListMock).toHaveBeenCalledWith({ query: '', limit: 50, category: 'software-rd' });
  });

  it('maps config error when server reports no base URL', async () => {
    marketplaceListMock.mockRejectedValueOnce(new Error('SKILLS_MARKETPLACE_NO_BASE_URL'));

    const { useSkillsMarketplaceStore } = await import('@/stores/skills-marketplace');
    await useSkillsMarketplaceStore.getState().fetchMarketplaceSkills('x');

    expect(useSkillsMarketplaceStore.getState().marketplaceError).toBe('marketplaceConfigError');
  });

  it('resetMarketplace clears state', async () => {
    marketplaceListMock.mockResolvedValueOnce({
      success: true,
      results: [{ slug: 'z', name: 'Z', description: '', version: '1' }],
    });

    const { useSkillsMarketplaceStore } = await import('@/stores/skills-marketplace');
    await useSkillsMarketplaceStore.getState().fetchMarketplaceSkills('');
    useSkillsMarketplaceStore.getState().resetMarketplace();

    expect(useSkillsMarketplaceStore.getState().marketplaceResults).toEqual([]);
    expect(useSkillsMarketplaceStore.getState().marketplaceError).toBeNull();
  });
});
