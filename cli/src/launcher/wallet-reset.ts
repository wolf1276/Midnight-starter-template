import { resetDeploymentWallet, walletFileDisplayPath, type DeploymentNetwork } from '../wallet-store.js';
import * as ui from '../ui.js';

const rawArgs = process.argv.slice(2);
const rawNetwork = rawArgs.find((a) => !a.startsWith('--')) ?? 'preview';

if (rawNetwork !== 'preview' && rawNetwork !== 'preprod') {
  ui.fail(`Unsupported network '${rawNetwork}'. Use 'preview' or 'preprod'.`);
  process.exit(1);
}

const network: DeploymentNetwork = rawNetwork;
const networkLabel = network === 'preprod' ? 'Preprod' : 'Preview';

ui.section(`🗑️  Resetting ${networkLabel} Deployment Wallet`);

const removed = resetDeploymentWallet(network);
if (removed) {
  ui.success(`Deleted ${walletFileDisplayPath(network)}`);
  ui.info('A new wallet will be created on the next deployment.');
} else {
  ui.info(`No saved ${networkLabel} wallet found — nothing to reset.`);
}
