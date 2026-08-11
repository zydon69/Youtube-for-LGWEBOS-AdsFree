import assert from 'node:assert/strict';
import test from 'node:test';

import { transformAccountSelectorCommand } from '../src/core/account-selection.ts';

test('account selection uses only an explicit non-empty next endpoint', () => {
  const nextEndpoint = { browseEndpoint: { browseId: 'home' } };
  const payload = {
    startAccountSelectorCommand: { nextEndpoint },
    commandMetadata: {
      webCommandMetadata: { rootVe: 12 },
      loggingDirectives: { trackingParams: 'kept' }
    },
    sibling: true
  };

  const transformed = transformAccountSelectorCommand(payload);

  assert.equal('startAccountSelectorCommand' in transformed, false);
  assert.equal(transformed.sibling, true);
  assert.equal(
    transformed.commandMetadata.loggingDirectives.trackingParams,
    'kept'
  );
  assert.deepEqual(
    transformed.onIdentityChanged.identityActionContext.nextEndpoint,
    nextEndpoint
  );
  assert.equal(
    transformed.commandMetadata.webCommandMetadata.clientAction,
    true
  );
});

test('account selection leaves ambiguous commands untouched', () => {
  for (const payload of [
    {},
    { startAccountSelectorCommand: {} },
    { startAccountSelectorCommand: { nextEndpoint: {} } },
    {
      startAccountSelectorCommand: { nextEndpoint: { browseEndpoint: {} } },
      onIdentityChanged: { existing: true }
    }
  ]) {
    assert.equal(transformAccountSelectorCommand(payload), payload);
  }
});
