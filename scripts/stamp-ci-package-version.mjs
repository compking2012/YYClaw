#!/usr/bin/env node
/**
 * CI-only: keep package.json "version" as valid semver (required by electron-builder),
 * and write buildDisplayVersion = YYYYMMDD-HHMMSS for artifact names, daily upload
 * dirs, and in-app About. Display stamp is intentionally not semver — only
 * "version" must be.
 *
 * Example:
 *   version: 0.4.16
 *   buildDisplayVersion: 20260721-164404
 *
 * Env:
 *   STAMP_TIMESTAMP  Optional override (YYYYMMDD-HHMMSS). Default: now in Asia/Shanghai.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

/** Prior mistaken formats that may have been written into "version". */
const CI_STAMP_PREFIX_RE = /^(\d{8}-\d{6})-(.+)$/;
const CI_STAMP_SUFFIX_RE = /-\d{8}-\d{6}$/;

function shanghaiStamp() {
  if (process.env.STAMP_TIMESTAMP) {
    const override = String(process.env.STAMP_TIMESTAMP).trim();
    if (!/^\d{8}-\d{6}$/.test(override)) {
      console.error(
        `[stamp-ci-package-version] STAMP_TIMESTAMP must be YYYYMMDD-HHMMSS, got: ${override}`,
      );
      process.exit(1);
    }
    return override;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}${get('second')}`;
}

function stripBuildMetadata(version) {
  const plus = version.indexOf('+');
  return plus === -1 ? version : version.slice(0, plus);
}

/** Recover repo semver from a plain or previously stamped value. */
function baseSemver(current) {
  const withoutMeta = stripBuildMetadata(String(current).trim());
  const prefix = withoutMeta.match(CI_STAMP_PREFIX_RE);
  if (prefix) return prefix[2];
  return withoutMeta.replace(CI_STAMP_SUFFIX_RE, '');
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const previousVersion = pkg.version;
const previousDisplay = pkg.buildDisplayVersion;
const stamp = shanghaiStamp();
const base = baseSemver(previousVersion);

if (!/^\d+\.\d+\.\d+/.test(base)) {
  console.error(
    `[stamp-ci-package-version] could not recover a semver base from version="${previousVersion}"`,
  );
  process.exit(1);
}

pkg.version = base;
pkg.buildDisplayVersion = stamp;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8');

mkdirSync(join(root, '.build-rel'), { recursive: true });
writeFileSync(join(root, '.build-rel/display-version'), `${stamp}\n`, 'utf8');

console.log(
  `[stamp-ci-package-version] version ${previousVersion} → ${base}` +
    (previousDisplay ? ` (was display ${previousDisplay})` : ''),
);
console.log(`[stamp-ci-package-version] buildDisplayVersion → ${stamp}`);
