declare const __OPENCLAW_VERSION__: string;

declare module '*.mjs' {
  const value: unknown;
  export default value;
  export const MAIN_PROCESS_BUNDLED_ROOT_PACKAGES: readonly string[];
  export function collectBundledPackageGraph(rootDir: string, packageNames: Iterable<string>): Set<string>;
  export function isBundledMainProcessImport(importId: string, bundledPackages: Set<string>): boolean;
}
