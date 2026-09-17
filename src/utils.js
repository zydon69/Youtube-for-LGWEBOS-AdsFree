import { buildLaunchURL, parseLaunchParams } from './core/launch.js';

export function extractLaunchParams() {
  try {
    return parseLaunchParams(window.launchParams);
  } catch (error) {
    console.warn('[launch] Unable to read launch parameters', error);
    return {};
  }
}

/** @param {unknown} params */
export function handleLaunch(params) {
  const target = buildLaunchURL(params);
  window.location.assign(target.href);
}
