import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';
import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener
} from './config';
import { transformAccountSelectorCommand } from './core/account-selection';

let startupSelectionConsumed = false;

const hook: ResolveCommandHook = (payload) => {
  if (startupSelectionConsumed || !configRead('autoAccountSelect'))
    return payload;
  const transformed = transformAccountSelectorCommand(payload);
  if (transformed !== payload) startupSelectionConsumed = true;
  return transformed;
};

let installedRegistry: ResolveCommandRegistry | null = null;
let featureInstalled = false;

export function installAutoAccountSelect() {
  if (installedRegistry || !configRead('autoAccountSelect')) return;
  const registry = ResolveCommandRegistry.getDeferredInstance();
  registry.setHook('startAccountSelectorCommand', hook);
  installedRegistry = registry;
}

export function disposeAutoAccountSelect() {
  installedRegistry?.removeHook('startAccountSelectorCommand');
  installedRegistry = null;
}

function synchronizeAutoAccountSelect(enabled: boolean) {
  if (!enabled) {
    disposeAutoAccountSelect();
    return;
  }
  installAutoAccountSelect();
}

const handleConfigChange = (event: CustomEvent<{ newValue: boolean }>) => {
  synchronizeAutoAccountSelect(event.detail.newValue);
};

export function installAutoAccountSelectFeature() {
  if (featureInstalled) return;
  configAddChangeListener('autoAccountSelect', handleConfigChange);
  featureInstalled = true;
  try {
    if (configRead('autoAccountSelect')) installAutoAccountSelect();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function dispose() {
  featureInstalled = false;
  configRemoveChangeListener('autoAccountSelect', handleConfigChange);
  disposeAutoAccountSelect();
}
