'use strict';

const {
  ArrayIsArray,
  ObjectCreate,
} = primordials;

const { ESMLoader } = require('internal/modules/esm/loader');
const {
  hasUncaughtExceptionCaptureCallback,
} = require('internal/process/execution');
const { pathToFileURL } = require('internal/url');

const esmLoader = new ESMLoader();
exports.esmLoader = esmLoader;

// Module.runMain() causes loadESM() to re-run (which it should do); however, this should NOT cause
// ESM to be re-initialised; doing so causes duplicate custom loaders to be added to the public
// esmLoader.
let isESMInitialized = false;

/**
 * Causes side-effects: user-defined loader hooks are added to esmLoader.
 * @returns {void}
 */
async function initializeLoader() {
  if (isESMInitialized) { return; }

  const { getOptionValue } = require('internal/options');
  const customLoaders = getOptionValue('--experimental-loader');
  const preloadModules = getOptionValue('--import');
  const loaders = await loadModulesInIsolation(customLoaders);

  // Hooks must then be added to external/public loader
  // (so they're triggered in userland)
  esmLoader.addCustomLoaders(loaders);

  // Preload after loaders are added so they can be used
  if (preloadModules?.length) {
    await loadModulesInIsolation(preloadModules, loaders);
  }

  isESMInitialized = true;
}

function loadModulesInIsolation(specifiers, loaders = []) {
  if (!ArrayIsArray(specifiers) || specifiers.length === 0) { return; }

  let cwd;
  try {
    cwd = process.cwd() + '/';
  } catch {
    cwd = 'file:///';
  }

  // A separate loader instance is necessary to avoid cross-contamination
  // between internal Node.js and userland. For example, a module with internal
  // state (such as a counter) should be independent.
  const internalEsmLoader = new ESMLoader();
  internalEsmLoader.addCustomLoaders(loaders);

  // Importation must be handled by internal loader to avoid poluting userland
  return internalEsmLoader.import(
    specifiers,
    pathToFileURL(cwd).href,
    ObjectCreate(null),
  );
}

exports.loadESM = async function loadESM(callback) {
  try {
    await initializeLoader();
    await callback(esmLoader);
  } catch (err) {
    if (hasUncaughtExceptionCaptureCallback()) {
      process._fatalException(err);
      return;
    }
    internalBinding('errors').triggerUncaughtException(
      err,
      true /* fromPromise */
    );
  }
};
