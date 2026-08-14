/**
 * Fixes webosbrew/youtube-webos/issues/343
 */

import { FetchRegistry } from './hooks';
import { isWebOSCastWakeRequest } from './core/request-policy';

const registry = FetchRegistry.getInstance();
let installed = false;
const handleRequest = (evt: {
  detail: { url: URL };
  preventDefault(): void;
}) => {
  const { url } = evt.detail;
  if (isWebOSCastWakeRequest(url)) evt.preventDefault();
};

export function installBlockWebOSCast() {
  if (installed) return;
  registry.addEventListener('request', handleRequest);
  installed = true;
}

export function dispose() {
  if (!installed) return;
  registry.removeEventListener('request', handleRequest);
  installed = false;
}
