import { ActiveMediaResolver } from '../core/active-media-resolver.ts';
import { pollUntil } from '../core/poll.js';

import type { ManagedYTPlayer } from './yt-api';

const REQUIRED_PLAYER_METHODS = [
  'addEventListener',
  'removeEventListener',
  'getVideoData',
  'getPlayerStateObject'
] as const satisfies readonly (keyof ManagedYTPlayer)[];

interface MatchableElement {
  matches?: (selectors: string) => boolean;
  webkitMatchesSelector?: (selectors: string) => boolean;
  msMatchesSelector?: (selectors: string) => boolean;
}

/** Cross-realm selector matching for the Safari versions used by older TVs. */
export function elementMatches(value: unknown, selectors: string) {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as MatchableElement;
  const matcher =
    candidate.matches ??
    candidate.webkitMatchesSelector ??
    candidate.msMatchesSelector;
  if (typeof matcher !== 'function') return false;
  try {
    return Reflect.apply(matcher, value, [selectors]) === true;
  } catch {
    return false;
  }
}

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

/**
 * document.querySelector but waits for the Element to be added if it doesn't already exist.
 */
/**
 * Manager-only lookup that ignores DOM placeholders until the complete private
 * player capability contract is available.
 */
export async function getCapablePlayer(
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ManagedYTPlayer> {
  const existing = findCapablePlayer();
  if (existing) return existing;

  if (!document.body && !document.documentElement) {
    throw new Error(
      'Cannot observe the YouTube player before the document exists'
    );
  }
  return pollUntil(() => findCapablePlayer(), {
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs ?? 24 * 60 * 60 * 1000,
    initialDelayMs: 25,
    maxDelayMs: 500,
    scheduler: window
  });
}
