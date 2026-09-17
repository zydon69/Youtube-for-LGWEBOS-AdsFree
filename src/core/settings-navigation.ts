import { elementMatches } from './dom-elements.ts';

type Direction = 'left' | 'right' | 'up' | 'down';

export function getFocusableSettings(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>('input, button, select, [tabindex]')
  ).filter((element) => {
    if (element.tabIndex < 0 || elementMatches(element, ':disabled'))
      return false;
    let ancestor: HTMLElement | null = element;
    while (ancestor && ancestor !== panel) {
      const style = window.getComputedStyle(ancestor);
      if (
        ancestor.hidden ||
        ancestor.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      )
        return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

export function moveSettingsFocus(panel: HTMLElement, direction: Direction) {
  const candidates = getFocusableSettings(panel);
  const active = document.activeElement;
  const current =
    active instanceof HTMLElement ? candidates.indexOf(active) : -1;
  if (current < 0) {
    (candidates[0] ?? panel).focus();
    return;
  }
  const origin = candidates[current]!;
  const bounds = origin.getBoundingClientRect();
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const originMain = horizontal
    ? (bounds.left + bounds.right) / 2
    : (bounds.top + bounds.bottom) / 2;
  const originCross = horizontal
    ? (bounds.top + bounds.bottom) / 2
    : (bounds.left + bounds.right) / 2;
  let next: HTMLElement | undefined;
  let best = Infinity;
  for (const candidate of candidates) {
    if (candidate === origin) continue;
    const rect = candidate.getBoundingClientRect();
    const main = horizontal
      ? (rect.left + rect.right) / 2
      : (rect.top + rect.bottom) / 2;
    const cross = horizontal
      ? (rect.top + rect.bottom) / 2
      : (rect.left + rect.right) / 2;
    const distance = (main - originMain) * sign;
    if (distance <= 0) continue;
    const score = distance + Math.abs(cross - originCross) * 2;
    if (score < best) {
      best = score;
      next = candidate;
    }
  }
  // The settings form is ordered vertically. Zero-sized layouts (including
  // pending layout) still have a deterministic reading order for up/down.
  if (!next && !horizontal && bounds.width === 0 && bounds.height === 0) {
    next = candidates[current + sign];
  }
  if (!next) return;
  next.focus();
  // Scroll only the dialog, never the host page or an unrelated player.
  const panelRect = panel.getBoundingClientRect();
  const rect = next.getBoundingClientRect();
  if (rect.top < panelRect.top) panel.scrollTop -= panelRect.top - rect.top;
  else if (rect.bottom > panelRect.bottom)
    panel.scrollTop += rect.bottom - panelRect.bottom;
}
