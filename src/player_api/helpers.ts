import { waitForChildAdd } from '../utils.js';

import type { YTPlayer } from './yt-api';

/**
 * document.querySelector but waits for the Element to be added if it doesn't already exist.
 */
export async function requireElement<E extends typeof Element>(
  cssSelectors: string,
  expected: E,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<InstanceType<E>> {
  const alreadyPresent = document.querySelector(cssSelectors);
  if (alreadyPresent) {
    if (!(alreadyPresent instanceof expected)) throw new Error();

    // Cast required due to narrowing limitations.
    // https://github.com/microsoft/TypeScript/issues/55241
    return alreadyPresent as InstanceType<E>;
  }

  const observationRoot = document.body ?? document.documentElement;
  if (!observationRoot) {
    throw new Error(
      `Cannot observe "${cssSelectors}" before the document exists`
    );
  }

  const result = await waitForChildAdd(
    observationRoot,
    (node): node is Element =>
      node instanceof Element && node.matches(cssSelectors),
    options
  );

  if (!(result instanceof expected)) throw new Error();
  return result as InstanceType<E>;
}

export async function getPlayer(): Promise<YTPlayer> {
  return requireElement('.html5-video-player', HTMLElement, {
    timeoutMs: 24 * 60 * 60 * 1000
  }) as Promise<YTPlayer>;
}
