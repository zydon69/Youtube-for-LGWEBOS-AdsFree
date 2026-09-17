const presentationHidden = new WeakSet<HTMLVideoElement>();

/** Preserve playback identity when our screen-off feature hides presentation. */
export function setMediaPresentationHidden(
  video: HTMLVideoElement,
  hidden: boolean
): void {
  if (hidden) presentationHidden.add(video);
  else presentationHidden.delete(video);
}

type VideoCandidate = HTMLVideoElement & {
  readonly tagName: string;
  readonly isConnected?: boolean;
};

interface CandidateScore {
  readonly video: VideoCandidate;
  readonly visibleArea: number;
  readonly totalArea: number;
  readonly playing: boolean;
  readonly presentationHidden: boolean;
  readonly order: number;
}

function isVideoCandidate(value: unknown): value is VideoCandidate {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<VideoCandidate>;
  return (
    String(candidate.tagName).toUpperCase() === 'VIDEO' &&
    typeof candidate.getBoundingClientRect === 'function'
  );
}

function collectVideos(root: ParentNode) {
  const videos: VideoCandidate[] = [];
  if (isVideoCandidate(root)) videos.push(root);
  const descendants = root.querySelectorAll('video');
  for (let index = 0; index < descendants.length; index++) {
    const candidate = descendants[index];
    if (isVideoCandidate(candidate) && !videos.includes(candidate)) {
      videos.push(candidate);
    }
  }
  return videos;
}

function getCandidateScore(
  video: VideoCandidate,
  documentRef: Document,
  order: number
): CandidateScore | null {
  if (video.isConnected === false) return null;
  const applicationHidden = presentationHidden.has(video);
  if (video.hidden) return null;

  const inlineStyle = video.style;
  let display = inlineStyle?.display;
  let visibility = inlineStyle?.visibility;
  try {
    const computedStyle = documentRef.defaultView?.getComputedStyle(video);
    display = computedStyle?.display || display;
    visibility = computedStyle?.visibility || visibility;
  } catch {
    // Cross-realm style inspection is best-effort; geometry remains authoritative.
  }
  if (
    display === 'none' ||
    visibility === 'collapse' ||
    (!applicationHidden && visibility === 'hidden')
  ) {
    return null;
  }

  // Screen-off owns only the video's visibility. Host-hidden containers still
  // retire a player and must never remain pinned over its replacement.
  for (
    let parent = video.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent.hidden) return null;
    let parentDisplay = parent.style?.display;
    try {
      parentDisplay =
        documentRef.defaultView?.getComputedStyle(parent)?.display ||
        parentDisplay;
    } catch {
      // Inline styles remain available when cross-realm style inspection fails.
    }
    if (parentDisplay === 'none') return null;
  }

  let rect: DOMRect | DOMRectReadOnly;
  try {
    rect = video.getBoundingClientRect();
  } catch {
    return null;
  }
  const width = Math.max(0, Number(rect.width) || 0);
  const height = Math.max(0, Number(rect.height) || 0);
  const totalArea = width * height;
  const viewportWidth =
    documentRef.defaultView?.innerWidth ??
    documentRef.documentElement?.clientWidth ??
    0;
  const viewportHeight =
    documentRef.defaultView?.innerHeight ??
    documentRef.documentElement?.clientHeight ??
    0;
  const visibleWidth = Math.max(
    0,
    Math.min(Number(rect.right) || 0, viewportWidth) -
      Math.max(Number(rect.left) || 0, 0)
  );
  const visibleHeight = Math.max(
    0,
    Math.min(Number(rect.bottom) || 0, viewportHeight) -
      Math.max(Number(rect.top) || 0, 0)
  );

  return {
    video,
    visibleArea: visibleWidth * visibleHeight,
    totalArea,
    presentationHidden: applicationHidden,
    playing: video.paused === false && video.ended !== true,
    order
  };
}

function isBetterCandidate(next: CandidateScore, current: CandidateScore) {
  const nextListening = next.presentationHidden && next.playing;
  const currentListening = current.presentationHidden && current.playing;
  if (nextListening !== currentListening) return nextListening;
  if (next.visibleArea !== current.visibleArea) {
    return next.visibleArea > current.visibleArea;
  }
  if (next.playing !== current.playing) return next.playing;
  if (next.totalArea !== current.totalArea)
    return next.totalArea > current.totalArea;
  return next.order < current.order;
}

/** Selects the same active video for every feature, including cross-realm DOM. */
export class ActiveMediaResolver {
  readonly #document: Document;

  constructor(documentRef: Document = document) {
    this.#document = documentRef;
  }

  resolveVideo(playerRoot?: ParentNode | null): HTMLVideoElement | null {
    const candidates = collectVideos(playerRoot ?? this.#document);
    let selected: CandidateScore | null = null;

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const score = getCandidateScore(candidate, this.#document, index);
      if (score && (!selected || isBetterCandidate(score, selected))) {
        selected = score;
      }
    }

    return selected?.video ?? null;
  }

  /**
   * Correlates a set of player roots with the same media scoring used by every
   * feature. If no root exposes a usable video yet, DOM order is the stable
   * bootstrap fallback.
   */
  resolvePlayerRoot<T extends ParentNode>(roots: ArrayLike<T>): T | null {
    const fallback = roots[0] ?? null;
    let selectedRoot: T | null = null;
    let selectedScore: CandidateScore | null = null;

    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      if (!root) continue;
      const videos = collectVideos(root);
      let score: CandidateScore | null = null;
      for (let videoIndex = 0; videoIndex < videos.length; videoIndex++) {
        const video = videos[videoIndex];
        if (!video) continue;
        const candidateScore = getCandidateScore(
          video,
          this.#document,
          videoIndex
        );
        if (
          candidateScore &&
          (!score || isBetterCandidate(candidateScore, score))
        ) {
          score = candidateScore;
        }
      }
      if (
        score &&
        (!selectedScore ||
          isBetterCandidate({ ...score, order: index }, selectedScore))
      ) {
        selectedRoot = root;
        selectedScore = { ...score, order: index };
      }
    }

    return selectedRoot ?? fallback;
  }
}

export function resolveActiveVideo(
  playerRoot?: ParentNode | null,
  documentRef: Document = document
) {
  return new ActiveMediaResolver(documentRef).resolveVideo(playerRoot);
}
