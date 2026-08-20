import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getOpenClawConfigDir, ensureDir } from '../../utils/paths';
import { safeRmSync } from '../../utils/safe-fs';
import type {
  Extension,
  ExtensionContext,
  MarketplaceProviderExtension,
  MarketplaceCapability,
} from '../types';
import type {
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubSkillResult,
} from '../../gateway/clawhub';
import { resolveFarmApiBaseUrl } from '../../utils/farm-api-base';

class CompanyHubMarketplaceExtension implements MarketplaceProviderExtension {
  readonly id = 'builtin/company-hub-marketplace';

  setup(_ctx: ExtensionContext): void {}

  async getCapability(): Promise<MarketplaceCapability> {
    return {
      mode: 'companyhub',
      canSearch: true,
      canInstall: true,
    };
  }

  async search(_params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
    // Optionally return an empty list if search via company backend is not implemented yet.
    // The main requirement was to support installation via backend commands.
    return [];
  }

  async install(params: ClawHubInstallParams): Promise<void> {
    const payload = params as Record<string, any>;
    const version = payload.skill_version || params.version;
    const slug = params.slug;

    if (!version) {
      throw new Error('Company hub requires a skill_version to download.');
    }

    const baseUrl = resolveFarmApiBaseUrl();
    if (!baseUrl) {
      throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
    }
    const downloadUrl = `${baseUrl}/api/v1/agent/skills/versions/${version}/download`;

    console.log(`Downloading skill from ${downloadUrl}`);
    const response = await proxyAwareFetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download skill: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    const workDir = getOpenClawConfigDir();
    const skillsDir = path.join(workDir, 'skills');
    ensureDir(skillsDir);

    const targetDir = path.join(skillsDir, slug);

    // Save zip to temp file
    const tempZipPath = path.join(skillsDir, `.temp-${slug}-${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, buffer);

    try {
      const zip = new AdmZip(tempZipPath);
      const tempExtractDir = path.join(skillsDir, `.extract-${slug}-${Date.now()}`);
      ensureDir(tempExtractDir);
      zip.extractAllTo(tempExtractDir, true);

      // Delete old target if exists
      if (fs.existsSync(targetDir)) {
        let rmRetries = 10;
        while (rmRetries > 0) {
          try {
            // Not fs.rmSync: skill directories can hold symlinks/junctions that
            // escape the tree (see gateway/skills-symlink-cleanup.ts), and the
            // recursive remove follows those on Windows.
            safeRmSync(targetDir);
            break;
          } catch (e: any) {
            if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && rmRetries > 1) {
              await new Promise(r => setTimeout(r, 500));
              rmRetries--;
            } else {
              throw new Error(`Failed to remove old skill directory: ${e.message || String(e)}`);
            }
          }
        }
      }

      let retries = 10;
      while (retries > 0) {
        try {
          fs.renameSync(tempExtractDir, targetDir);
          break;
        } catch (e: any) {
          if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && retries > 1) {
            await new Promise(r => setTimeout(r, 500));
            retries--;
          } else {
            throw new Error(`Failed to rename extracted skill directory: ${e.message || String(e)}`);
          }
        }
      }
    } finally {
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
    }
  }
}

export function createCompanyHubMarketplaceExtension(): Extension {
  return new CompanyHubMarketplaceExtension();
}
