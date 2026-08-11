export const TRUSTED_YOUTUBE_ORIGIN = 'https://www.youtube.com';

export interface RuntimeContext {
  readonly self: unknown;
  readonly top: unknown;
  readonly location: {
    readonly href: string;
    readonly origin?: string;
  };
}

/**
 * User scripts execute with the privileges of the hosted YouTube application.
 * Refuse child frames and unexpected origins before loading any side-effectful
 * module.
 */
export function isTrustedRuntimeContext(
  context: RuntimeContext,
  trustedOrigin = TRUSTED_YOUTUBE_ORIGIN
) {
  try {
    if (context.self !== context.top) return false;
    const origin =
      context.location.origin || new URL(context.location.href).origin;
    return origin === trustedOrigin;
  } catch {
    return false;
  }
}
