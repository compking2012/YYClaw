// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const getOpenClawConfigDirMock = vi.fn();
const proxyAwareFetchMock = vi.fn();

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => getOpenClawConfigDirMock(),
  getResourcesDir: () => resolve(process.cwd(), 'resources'),
  ensureDir: (dir: string) => mkdirSync(dir, { recursive: true }),
}));

vi.mock('@electron/utils/skill-config', () => ({
  removeSkillConfig: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

function buildSkillZip(name: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\n---\n`, 'utf8'));
  return zip.toBuffer();
}

function zipResponse(name: string): Response {
  // Pass a real Uint8Array so Node's Response keeps zip bytes intact.
  return new Response(new Uint8Array(buildSkillZip(name)), {
    status: 200,
    headers: { 'Content-Type': 'application/zip' },
  });
}

function skillInstalled(openclawDir: string, skillName: string): boolean {
  const skillsRoot = join(openclawDir, 'skills');
  if (!existsSync(skillsRoot)) return false;
  return readdirSync(skillsRoot).some((name) => name === skillName || name.startsWith(`${skillName}--`));
}

describe('server marketplace install download_count report', () => {
  const previousFarmBaseUrl = process.env.YYCLAW_FARM_API_BASE_URL;
  beforeEach(() => {
    // The server marketplace needs an explicit Farm base URL; package.json ships
    // empty by default, so set it here instead of depending on deploy config.
    process.env.YYCLAW_FARM_API_BASE_URL = 'https://farm.test';
  });
  afterAll(() => {
    if (previousFarmBaseUrl === undefined) delete process.env.YYCLAW_FARM_API_BASE_URL;
    else process.env.YYCLAW_FARM_API_BASE_URL = previousFarmBaseUrl;
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('POSTs skill_client_install after downloadAndInstallServerSkill succeeds', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-install-report-'));
    const openclawDir = join(homeDir, '.openclaw');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    proxyAwareFetchMock
      .mockResolvedValueOnce(zipResponse('enterprise-storage-memory'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { downloadAndInstallServerSkill } = await import('../../electron/services/skills-marketplace-client');
    await downloadAndInstallServerSkill(
      'enterprise-storage-memory',
      'hash-71',
      '71',
      '1.0.0',
      'enterprise-storage-memory',
    );

    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(2);
    const [reportUrl, reportInit] = proxyAwareFetchMock.mock.calls[1] as [string, RequestInit];
    expect(reportUrl).toMatch(/\/api\/v1\/skill_client_install$/);
    expect(reportInit.method).toBe('POST');
    expect(JSON.parse(String(reportInit.body))).toEqual({
      name: 'enterprise-storage-memory',
      version_base: 'enterprise-storage-memory',
    });
    expect(skillInstalled(openclawDir, 'enterprise-storage-memory')).toBe(true);
  });

  it('POSTs skill_client_install after prepareServerSkillInstall().install succeeds', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-prepare-report-'));
    const openclawDir = join(homeDir, '.openclaw');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    proxyAwareFetchMock
      .mockResolvedValueOnce(zipResponse('brave-search'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { prepareServerSkillInstall } = await import('../../electron/services/skills-marketplace-client');
    const prepared = await prepareServerSkillInstall(
      'brave-search',
      'hash-1',
      '1',
      '1.0.1',
      'brave-search',
    );
    await prepared.install();

    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(2);
    const [reportUrl, reportInit] = proxyAwareFetchMock.mock.calls[1] as [string, RequestInit];
    expect(reportUrl).toMatch(/\/api\/v1\/skill_client_install$/);
    expect(reportInit.method).toBe('POST');
    expect(JSON.parse(String(reportInit.body))).toEqual({
      name: 'brave-search',
      version_base: 'brave-search',
    });
    expect(skillInstalled(openclawDir, 'brave-search')).toBe(true);
  });

  it('still completes local install when skill_client_install reporting fails', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-install-report-fail-'));
    const openclawDir = join(homeDir, '.openclaw');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    proxyAwareFetchMock
      .mockResolvedValueOnce(zipResponse('adsales'))
      .mockRejectedValueOnce(new Error('network down'));

    const { downloadAndInstallServerSkill } = await import('../../electron/services/skills-marketplace-client');
    await expect(
      downloadAndInstallServerSkill('adsales', undefined, undefined, '1.0.0', 'adsales'),
    ).resolves.toBeUndefined();

    expect(skillInstalled(openclawDir, 'adsales')).toBe(true);
  });
});
