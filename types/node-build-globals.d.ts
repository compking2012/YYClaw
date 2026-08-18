declare const __ENABLE_LANGGRAPH__: boolean;
declare const __OPENCLAW_VERSION__: string;
declare const __SHOW_OFFICE_COLLABORATION__: boolean;
declare const __SHOW_OFFICE_SESSIONS__: boolean;
declare const __OFFICE_USER_CHECKPOINT__: boolean;

declare module '*.mjs' {
  const value: unknown;
  export default value;
  export const MAIN_PROCESS_BUNDLED_ROOT_PACKAGES: readonly string[];
  export function collectBundledPackageGraph(rootDir: string, packageNames: Iterable<string>): Set<string>;
  export function isBundledMainProcessImport(importId: string, bundledPackages: Set<string>): boolean;
  export function isLangGraphCompileEnabled(): boolean;
  export function loadLangGraphEnvFiles(mode?: string): void;
  export function isOfficeCollaborationConfigurable(): boolean;
  export function isOfficeSessionsVisible(): boolean;
  export function loadOfficeEnvFiles(mode?: string): void;
  export function isOfficeUserCheckpointEnabled(): boolean;
  export function loadOfficeUserCheckpointEnv(mode?: string): void;
}
