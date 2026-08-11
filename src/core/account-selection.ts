export type CommandPayload = Record<string, unknown>;

function isRecord(value: unknown): value is CommandPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Converts YouTube's account-selector command into its already-provided next
 * endpoint. The transformation is deliberately conservative: ambiguous or
 * already-transformed commands pass through unchanged.
 */
export function transformAccountSelectorCommand(payload: CommandPayload) {
  if (
    !Object.hasOwn(payload, 'startAccountSelectorCommand') ||
    Object.hasOwn(payload, 'onIdentityChanged')
  ) {
    return payload;
  }

  const selector = payload.startAccountSelectorCommand;
  if (!isRecord(selector) || !Object.hasOwn(selector, 'nextEndpoint')) {
    return payload;
  }
  const finalEndpoint = selector.nextEndpoint;
  if (!isRecord(finalEndpoint) || Object.keys(finalEndpoint).length === 0) {
    return payload;
  }

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
}
