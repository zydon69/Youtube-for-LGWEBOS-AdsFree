import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';
import { configRead } from './config';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function installAutoAccountSelect() {
  const registry = await ResolveCommandRegistry.getInstance();

  const hook: ResolveCommandHook = (payload) => {
    if (!configRead('autoAccountSelect')) {
      return payload;
    }

    const selector = payload.startAccountSelectorCommand;
    const finalEndpoint = isRecord(selector) ? selector.nextEndpoint : null;
    if (!isRecord(finalEndpoint)) return payload;

    const remainingPayload = { ...payload };
    delete remainingPayload.startAccountSelectorCommand;
    const commandMetadata = isRecord(payload.commandMetadata)
      ? payload.commandMetadata
      : {};
    const webCommandMetadata = isRecord(commandMetadata.webCommandMetadata)
      ? commandMetadata.webCommandMetadata
      : {};
    return {
      ...remainingPayload,
      onIdentityChanged: {
        identityActionContext: {
          nextEndpoint: finalEndpoint,
          eventTrigger: 'ACCOUNT_EVENT_TRIGGER_WHOS_WATCHING'
        },
        isSameIdentity: true
      },
      commandMetadata: {
        ...commandMetadata,
        webCommandMetadata: { ...webCommandMetadata, clientAction: true }
      }
    };
  };

  registry.setHook('startAccountSelectorCommand', hook);
}

void installAutoAccountSelect().catch((error) => {
  console.warn('[auto-account-select] Feature unavailable', error);
});
