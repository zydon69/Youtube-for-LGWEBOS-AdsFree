import { elementMatches } from '../core/dom-elements.ts';
export { elementMatches } from '../core/dom-elements.ts';
import { ActiveMediaResolver } from '../core/active-media-resolver.ts';
import { startPolling } from '../core/poll.js';

import type { ManagedYTPlayer } from './yt-api';

const REQUIRED_PLAYER_METHODS = [
  'addEventListener',
  'removeEventListener',
  'getVideoData',
  'getPlayerStateObject'
] as const satisfies readonly (keyof ManagedYTPlayer)[];

/** Runtime/cross-realm capability guard for YouTube's private player object. */
export function isYTPlayer(value: unknown): value is ManagedYTPlayer {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ManagedYTPlayer>;
  try {
    if (!elementMatches(candidate, '.html5-video-player')) {
      return false;
    }
    return REQUIRED_PLAYER_METHODS.every(
      (method) => typeof candidate[method] === 'function'
    );
  } catch {
    return false;
  }
}

function getRootDocument(root: ParentNode) {
  if ((root as Node).nodeType === 9) return root as Document;
  return (root as Node).ownerDocument ?? document;
}

export function findCapablePlayer(root: ParentNode = document) {
  const matches = root.querySelectorAll('.html5-video-player');
  const players: ManagedYTPlayer[] = [];
  if (isYTPlayer(root)) players.push(root);
  for (let index = 0; index < matches.length; index++) {
    const candidate = matches[index];
    if (isYTPlayer(candidate) && !players.includes(candidate)) {
      players.push(candidate);
    }
  }
  return new ActiveMediaResolver(getRootDocument(root)).resolvePlayerRoot(
    players
  );
}

/** Lookup owns cancellation even on TV engines without AbortController. */
export function startCapablePlayerLookup(
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
) {
  if (!document.body && !document.documentElement) {
    throw new Error(
      'Cannot observe the YouTube player before the document exists'
    );
  }
  return startPolling(() => findCapablePlayer(), {
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs ?? 24 * 60 * 60 * 1000,
    initialDelayMs: 25,
    maxDelayMs: 500,
    scheduler: window
  });
}

/** Promise adapter for callers that supply their own cancellation signal. */
export async function getCapablePlayer(
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ManagedYTPlayer> {
  return startCapablePlayerLookup(options).promise;
}
