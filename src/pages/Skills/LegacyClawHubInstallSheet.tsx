/**
 * Same install sheet as {@link ServerMarketplaceSheet}, with default source ClawHub (for compatibility / tests).
 */
import { ServerMarketplaceSheet, type ServerMarketplaceSheetProps } from './ServerMarketplaceSheet';

type Props = Omit<ServerMarketplaceSheetProps, 'defaultInstallSource'>;

export function LegacyClawHubInstallSheet(props: Props) {
  return <ServerMarketplaceSheet {...props} defaultInstallSource="clawhub" />;
}
