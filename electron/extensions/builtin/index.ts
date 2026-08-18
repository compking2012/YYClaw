import { registerBuiltinExtension } from '../loader';
import { createClawHubMarketplaceExtension } from './clawhub-marketplace';
import { createCompanyHubMarketplaceExtension } from './company-hub-marketplace';
import { createDiagnosticsExtension } from './diagnostics';

export function registerAllBuiltinExtensions(): void {
  registerBuiltinExtension('builtin/clawhub-marketplace', createClawHubMarketplaceExtension);
  registerBuiltinExtension('builtin/company-hub-marketplace', createCompanyHubMarketplaceExtension);
  registerBuiltinExtension('builtin/diagnostics', createDiagnosticsExtension);
}
