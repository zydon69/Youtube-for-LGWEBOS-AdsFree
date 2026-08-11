/** Own selected inline style properties without clobbering later host changes. */
export class InlineStyleOwner {
  #element;
  #properties = new Map();

  /** @param {HTMLElement} element @param {string[]} properties */
  constructor(element, properties) {
    this.#element = element;
    for (const property of properties) {
      this.#properties.set(property, {
        originalValue: element.style.getPropertyValue(property),
        originalPriority: element.style.getPropertyPriority(property),
        ownedValue: null,
        ownedPriority: null
      });
    }
  }

  /** @param {string} property @param {string} value @param {string} [priority] */
  set(property, value, priority = '') {
    const state = this.#properties.get(property);
    if (!state) throw new Error(`Unowned style property: ${property}`);
    const currentValue = this.#element.style.getPropertyValue(property);
    const currentPriority = this.#element.style.getPropertyPriority(property);
    const expectedValue =
      state.ownedValue === null ? state.originalValue : state.ownedValue;
    const expectedPriority =
      state.ownedValue === null ? state.originalPriority : state.ownedPriority;
    if (
      currentValue !== expectedValue ||
      currentPriority !== expectedPriority
    ) {
      // The host changed the property since our previous write. That latest
      // host value, not the value from construction time, is now what restore
      // must reveal after we temporarily take ownership again.
      state.originalValue = currentValue;
      state.originalPriority = currentPriority;
    }
    this.#element.style.setProperty(property, value, priority);
    state.ownedValue = this.#element.style.getPropertyValue(property);
    state.ownedPriority = this.#element.style.getPropertyPriority(property);
  }

  restore() {
    for (const [property, state] of this.#properties) {
      if (
        state.ownedValue !== null &&
        this.#element.style.getPropertyValue(property) === state.ownedValue &&
        this.#element.style.getPropertyPriority(property) ===
          state.ownedPriority
      ) {
        if (state.originalValue) {
          this.#element.style.setProperty(
            property,
            state.originalValue,
            state.originalPriority
          );
        } else {
          this.#element.style.removeProperty(property);
        }
      }
    }
    this.#properties.clear();
  }
}

/**
 * Acquire a feature state atomically: a failed subscription/notification
 * releases every partial resource and rolls the visible state back.
 *
 * @param {{ apply: () => boolean, subscribe: () => () => void, notify: () => void, rollback: () => void }} transaction
 */
export function acquireTransactionalOwnership({
  apply,
  subscribe,
  notify,
  rollback
}) {
  /** @type {(() => void) | null} */
  let release = null;
  try {
    if (!apply()) throw new Error('Unable to apply owned state');
    release = subscribe();
    if (typeof release !== 'function') {
      throw new TypeError('State subscription must return a disposer');
    }
    notify();
    return release;
  } catch (error) {
    try {
      release?.();
    } catch (releaseError) {
      console.warn(
        '[state] Unable to release partial subscription',
        releaseError
      );
    }
    try {
      rollback();
    } catch (rollbackError) {
      console.error('[state] Unable to roll back partial state', rollbackError);
    }
    throw error;
  }
}
