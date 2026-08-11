import { register } from 'node:module';

let cssLoaderRegistered = false;

export function registerCSSModuleStub() {
  if (cssLoaderRegistered) return;
  cssLoaderRegistered = true;
  const loader = `
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith('.') || /\\.[a-z0-9]+$/i.test(specifier)) {
          throw error;
        }
        for (const suffix of ['.ts', '.js', '/index.ts', '/index.js']) {
          try {
            return await nextResolve(specifier + suffix, context);
          } catch {}
        }
        throw error;
      }
    }

    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) {
        return {
          format: 'module',
          source: 'export default {};',
          shortCircuit: true
        };
      }
      return nextLoad(url, context);
    }
  `;
  register(
    `data:text/javascript,${encodeURIComponent(loader)}`,
    import.meta.url
  );
}

const WINDOW_GLOBALS = [
  'CSS',
  'CustomEvent',
  'DOMRect',
  'Element',
  'Event',
  'FocusEvent',
  'HTMLVideoElement',
  'HTMLElement',
  'KeyboardEvent',
  'MutationObserver',
  'Node',
  'PageTransitionEvent'
];

export function installDOMGlobals(browser) {
  const descriptors = new Map();
  const expose = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  };

  expose('window', browser);
  expose('document', browser.document);
  expose('self', browser);
  expose('navigator', browser.navigator);
  expose('getComputedStyle', browser.getComputedStyle.bind(browser));
  for (const key of WINDOW_GLOBALS) expose(key, browser[key]);

  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

export function dispatchLegacyKey(browser, type, keyCode, options = {}) {
  const event = new browser.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options
  });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  browser.document.dispatchEvent(event);
  return event;
}

export function waitForTimers(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
