/**
 * Remote skills marketplace catalog (server API) — separate from ClawHub search/install sheet state.
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import type { ServerMarketplaceSkill } from '@/types/skill';

function mapErrorToKey(code: AppError['code']): string {
  if (code === 'TIMEOUT') return 'marketplaceFetchTimeoutError';
  if (code === 'RATE_LIMIT') return 'marketplaceFetchRateLimitError';
  return 'marketplaceFetchError';
}

type MarketplaceState = {
  marketplaceResults: ServerMarketplaceSkill[];
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  fetchMarketplaceSkills: (query: string, category?: string) => Promise<void>;
  resetMarketplace: () => void;
};

export const useSkillsMarketplaceStore = create<MarketplaceState>((set) => ({
  marketplaceResults: [],
  marketplaceLoading: false,
  marketplaceError: null,

  resetMarketplace: () => {
    set({ marketplaceResults: [], marketplaceError: null });
  },

  fetchMarketplaceSkills: async (query: string, category?: string) => {
    set({ marketplaceLoading: true, marketplaceError: null });
    try {
      const result = await hostApi.skills.marketplaceList({
        query: query.trim(),
        limit: 50,
        category: category && category !== 'all' ? category : undefined,
      }) as {
        success: boolean;
        results?: ServerMarketplaceSkill[];
        error?: string;
      };
      if (result.success) {
        set({ marketplaceResults: result.results ?? [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'Marketplace request failed'), {
          module: 'skills-marketplace',
          operation: 'fetch',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : '';
      if (message.includes('SKILLS_MARKETPLACE_NO_BASE_URL')) {
        set({ marketplaceError: 'marketplaceConfigError' });
      } else if (name === 'AbortError' || /aborted|abort/i.test(message)) {
        set({ marketplaceError: 'marketplaceFetchTimeoutError' });
      } else {
        const appError = normalizeAppError(error, { module: 'skills-marketplace', operation: 'fetch' });
        set({ marketplaceError: mapErrorToKey(appError.code) });
      }
    } finally {
      set({ marketplaceLoading: false });
    }
  },
}));
