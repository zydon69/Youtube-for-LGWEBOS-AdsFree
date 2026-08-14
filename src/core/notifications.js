import './notifications.css';

/** @type {Record<string, string>} */
const COLOR_MAP = {
  red: 'rgba(255, 0, 0, 0.9)',
  green: 'rgba(0, 162, 0, 0.9)',
  yellow: 'rgba(255, 255, 0, 0.9)',
  blue: 'rgba(0, 128, 255, 0.9)',
  indigo: 'rgba(75, 0, 130, 0.9)',
  grey: 'rgba(255, 255, 255, 0.5)',
  none: 'rgba(0, 0, 0, 0)'
};

/** @type {Map<HTMLElement, number[]>} */
const notificationTimers = new Map();

/** @param {HTMLElement} element */
function removeNotification(element) {
  const timers = notificationTimers.get(element) ?? [];
  for (const timer of timers) window.clearTimeout(timer);
  notificationTimers.delete(element);
  element.remove();
}

/** @param {string} messageText @param {number} time @param {string} color */
export function showNotification(messageText, time = 3000, color = 'grey') {
  if (!document.body) return;
  const duration = Number.isFinite(time) ? Math.max(0, time) : 3000;
  let container = document.querySelector('.ytaf-notification-container');
  if (!(container instanceof HTMLElement)) {
    container = document.createElement('div');
    container.className = 'ytaf-notification-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  while (container.children.length >= 5) {
    const oldest = container.firstElementChild;
    if (oldest instanceof HTMLElement) removeNotification(oldest);
    else oldest?.remove();
  }

  const element = document.createElement('div');
  const message = document.createElement('div');
  message.textContent = messageText;
  message.className = 'message message-hidden';
  message.style.borderColor = COLOR_MAP[color] || color;
  element.appendChild(message);
  container.appendChild(element);

  const revealTimer = window.setTimeout(() => {
    if (document.documentElement.contains(element)) {
      message.classList.remove('message-hidden');
    }
  }, 100);
  const hideTimer = window.setTimeout(
    () => {
      message.classList.add('message-hidden');
      const removeTimer = window.setTimeout(
        () => removeNotification(element),
        1_000
      );
      notificationTimers.get(element)?.push(removeTimer);
    },
    Math.max(100, duration)
  );
  notificationTimers.set(element, [revealTimer, hideTimer]);
}

export function disposeNotifications() {
  for (const element of notificationTimers.keys()) removeNotification(element);
  document.querySelector('.ytaf-notification-container')?.remove();
}
