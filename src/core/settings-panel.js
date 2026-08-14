/* global __YTAF_VERSION__ */
import {
  configAddChangeListener,
  configGetDesc,
  configOptions,
  configRead,
  configWrite
} from '../config.js';
import { showNotification } from './notifications.js';
import { SPONSORBLOCK_CATEGORY_OPTIONS } from './sponsorblock-categories.js';

const PANEL_HEADING_ID = 'ytaf-settings-heading';
const SPONSOR_DESCRIPTION_ID = 'ytaf-sponsor-description';

/** @param {string} key @param {Array<() => void>} disposers @param {{ describedBy?: string }} [options] */
function createConfigCheckbox(key, disposers, { describedBy } = {}) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = configRead(key);
  if (describedBy) input.setAttribute('aria-describedby', describedBy);

  const changeHandler = () => {
    try {
      configWrite(key, input.checked);
    } catch (error) {
      input.checked = configRead(key);
      console.warn(`[ui] Unable to save "${key}"`, error);
      showNotification('Unable to save setting', 2500, 'red');
    }
  };
  input.addEventListener('change', changeHandler);
  disposers.push(() => input.removeEventListener('change', changeHandler));
  disposers.push(
    configAddChangeListener(key, (event) => {
      input.checked = event.detail.newValue;
    })
  );

  const label = document.createElement('label');
  label.append(input, document.createTextNode(`\u00a0${configGetDesc(key)}`));
  return label;
}

export function createSettingsPanel() {
  /** @type {Array<() => void>} */
  const disposers = [];
  try {
    const element = document.createElement('div');
    element.className = 'ytaf-ui-container';
    element.style.display = 'none';
    element.style.overflowY = 'auto';
    element.style.boxSizing = 'border-box';
    element.setAttribute('tabindex', '-1');
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-labelledby', PANEL_HEADING_ID);
    element.setAttribute('aria-hidden', 'true');

    const heading = document.createElement('h1');
    heading.id = PANEL_HEADING_ID;
    heading.textContent = 'YouTube AdFree';
    element.appendChild(heading);

    const sponsorCategoryKeys = new Set(
      SPONSORBLOCK_CATEGORY_OPTIONS.map((option) => option.configKey)
    );
    for (const key of configOptions.keys()) {
      if (key !== 'enableSponsorBlock' && !sponsorCategoryKeys.has(key)) {
        element.appendChild(createConfigCheckbox(key, disposers));
      }
    }
    element.appendChild(
      createConfigCheckbox('enableSponsorBlock', disposers, {
        describedBy: SPONSOR_DESCRIPTION_ID
      })
    );

    const categoryGroup = document.createElement('fieldset');
    const categoryLegend = document.createElement('legend');
    categoryLegend.textContent = 'SponsorBlock categories';
    categoryGroup.appendChild(categoryLegend);
    for (const option of SPONSORBLOCK_CATEGORY_OPTIONS) {
      categoryGroup.appendChild(
        createConfigCheckbox(option.configKey, disposers)
      );
    }
    element.appendChild(categoryGroup);

    const sponsorDescription = document.createElement('small');
    sponsorDescription.id = SPONSOR_DESCRIPTION_ID;
    sponsorDescription.className = 'ytaf-ui-sponsor';
    sponsorDescription.textContent =
      'Sponsor segments: data provided by sponsor.ajay.app';
    element.appendChild(sponsorDescription);

    const version = document.createElement('div');
    version.className = 'ytaf-ui-version';
    version.textContent = `v${__YTAF_VERSION__}`;
    element.appendChild(version);

    let disposed = false;
    return {
      element,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const removeListener of disposers.splice(0)) removeListener();
        element.remove();
      }
    };
  } catch (error) {
    for (const removeListener of disposers.splice(0)) {
      try {
        removeListener();
      } catch (cleanupError) {
        console.warn(
          '[ui] Unable to roll back a settings listener',
          cleanupError
        );
      }
    }
    throw error;
  }
}
