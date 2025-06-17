import { TokenListType } from '../../services/base';
import { ConfigManagerV2 } from '../../services/config-manager-v2';

interface NetworkConfig {
  name: string;
  nodeURL: string;
  tokenListType: TokenListType;
  tokenListSource: string;
  nativeCurrencySymbol: string;
}

export interface Config {
  network: NetworkConfig;
  defaultComputeUnits: number;
  basePriorityFeePct: number;
  priorityFeeMultiplier: number;
  maxPriorityFee: number;
  minPriorityFee: number;
  retryIntervalMs: number;
  retryCount: number;
}

export function getSolanaConfig(
  chainName: string,
  networkName: string,
): Config {
  // Get the base configuration from ConfigManagerV2
  const configManager = ConfigManagerV2.getInstance();
  
  // Try to get RPC URL from environment variables first, then fall back to config
  let nodeURL =
    process.env.HELIUS_RPC_URL ||
    process.env.HTTP_URL ||
    configManager.get(chainName + '.networks.' + networkName + '.nodeURL');
  
  // Ensure the URL has the proper protocol
  if (
    nodeURL &&
    !nodeURL.startsWith('http://') &&
    !nodeURL.startsWith('https://')
  ) {
    nodeURL = 'https://' + nodeURL;
  }

  return {
    network: {
      name: networkName,
      nodeURL: nodeURL,
      tokenListType: configManager.get(
        chainName + '.networks.' + networkName + '.tokenListType',
      ),
      tokenListSource: configManager.get(
        chainName + '.networks.' + networkName + '.tokenListSource',
      ),
      nativeCurrencySymbol: configManager.get(
        chainName + '.networks.' + networkName + '.nativeCurrencySymbol',
      ),
    },
    defaultComputeUnits: configManager.get(chainName + '.defaultComputeUnits'),
    basePriorityFeePct: configManager.get(chainName + '.basePriorityFeePct'),
    priorityFeeMultiplier: configManager.get(
      chainName + '.priorityFeeMultiplier',
    ),
    maxPriorityFee: configManager.get(chainName + '.maxPriorityFee'),
    minPriorityFee: configManager.get(chainName + '.minPriorityFee'),
    retryIntervalMs: configManager.get(chainName + '.retryIntervalMs'),
    retryCount: configManager.get(chainName + '.retryCount'),
  };
}
