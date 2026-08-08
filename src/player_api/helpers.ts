import { waitForChildAdd } from '../utils';

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

  const result = await waitForChildAdd(
    document.body,
    (node): node is Element =>
      node instanceof Element && node.matches(cssSelectors),
    { observeAttributes: true, ...options }
  );

  if (!(result instanceof expected)) throw new Error();
  return result as InstanceType<E>;
}

let playerPromise: Promise<YTPlayer> | null = null;

export async function getPlayer(): Promise<YTPlayer> {
  if (!playerPromise) {
    playerPromise = requireElement(
      '.html5-video-player',
      HTMLElement
    ) as Promise<YTPlayer>;
    playerPromise.catch(() => {
      playerPromise = null;
    });
  }

  return playerPromise;
}
