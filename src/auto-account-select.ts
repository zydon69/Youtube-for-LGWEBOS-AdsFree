import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';
import { configRead } from './config';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function installAutoAccountSelect() {
  const registry = await ResolveCommandRegistry.getInstance();

  const hook: ResolveCommandHook = (resolveCommand, payload, extra) => {
    if (!configRead('autoAccountSelect')) {
      return resolveCommand(payload, extra);
    }

    const selector = payload.startAccountSelectorCommand;
    const finalEndpoint = isRecord(selector) ? selector.nextEndpoint : null;
    if (!isRecord(finalEndpoint)) return resolveCommand(payload, extra);

    return registry.dispatchCommand(
      {
        onIdentityChanged: {
          identityActionContext: {
            nextEndpoint: finalEndpoint,
            eventTrigger: 'ACCOUNT_EVENT_TRIGGER_WHOS_WATCHING'
          },
          isSameIdentity: true
        },
        commandMetadata: { webCommandMetadata: { clientAction: true } }
      },
      extra
    );
  };

  registry.setHook('startAccountSelectorCommand', hook);
}

void installAutoAccountSelect().catch((error) => {
  console.warn('[auto-account-select] Feature unavailable', error);
});
