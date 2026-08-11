/**
 * Fixes webosbrew/youtube-webos/issues/343
 */

import { FetchRegistry } from './hooks';
import { isWebOSCastWakeRequest } from './core/request-policy';

const registry = FetchRegistry.getInstance();
const handleRequest = (evt: {
  detail: { url: URL };
  preventDefault(): void;
}) => {
  const { url } = evt.detail;
  if (isWebOSCastWakeRequest(url)) evt.preventDefault();
};

registry.addEventListener('request', handleRequest);

export function dispose() {
  registry.removeEventListener('request', handleRequest);
}
