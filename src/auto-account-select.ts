import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';
import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener
} from './config';
import { transformAccountSelectorCommand } from './core/account-selection';

const hook: ResolveCommandHook = (payload) =>
  configRead('autoAccountSelect')
    ? transformAccountSelectorCommand(payload)
    : payload;

let installedRegistry: ResolveCommandRegistry | null = null;
let installationGeneration = 0;
let featureInstalled = false;

export async function installAutoAccountSelect() {
  const generation = ++installationGeneration;
  if (installedRegistry) return;

  const registry = await ResolveCommandRegistry.getInstance();
  if (
    generation !== installationGeneration ||
    !configRead('autoAccountSelect')
  ) {
    return;
  }
  registry.setHook('startAccountSelectorCommand', hook);
  installedRegistry = registry;
}

export function disposeAutoAccountSelect() {
  installationGeneration++;
  installedRegistry?.removeHook('startAccountSelectorCommand');
  installedRegistry = null;
}

function synchronizeAutoAccountSelect(enabled: boolean) {
  if (!enabled) {
    disposeAutoAccountSelect();
    return;
  }
  void installAutoAccountSelect().catch((error) => {
    console.warn('[auto-account-select] Feature unavailable', error);
  });
}

const handleConfigChange = (event: CustomEvent<{ newValue: boolean }>) => {
  synchronizeAutoAccountSelect(event.detail.newValue);
};

export async function installAutoAccountSelectFeature() {
  if (featureInstalled) return;
  configAddChangeListener('autoAccountSelect', handleConfigChange);
  featureInstalled = true;
  try {
    if (configRead('autoAccountSelect')) await installAutoAccountSelect();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function dispose() {
  if (!featureInstalled) return;
  featureInstalled = false;
  configRemoveChangeListener('autoAccountSelect', handleConfigChange);
  disposeAutoAccountSelect();
}
