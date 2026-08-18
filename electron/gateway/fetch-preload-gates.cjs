'use strict';

function resolveRequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    if (typeof input.url === 'string') return input.url;
    if (typeof input.href === 'string') return input.href;
  }
  return '';
}

function isKnownLLMUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  return (
    url.indexOf('/chat/completions') !== -1 ||
    url.indexOf('/responses') !== -1 ||
    url.indexOf('/messages') !== -1 ||
    url.indexOf('generativelanguage') !== -1
  );
}

function resolveFetchGates(env, url) {
  var promptOptimizationEnabled = env && env.CLAWX_PROMPT_OPTIMIZATION_ENABLED === '1';
  var devDumpEnabled = env && env.CLAWX_DEV_MODE_UNLOCKED === '1';
  var known = isKnownLLMUrl(url);
  var shouldOptimize = promptOptimizationEnabled;
  var shouldDump = promptOptimizationEnabled && devDumpEnabled;
  var shouldIntercept = shouldOptimize && known;
  return {
    shouldOptimize: shouldOptimize,
    shouldDump: shouldDump,
    shouldIntercept: shouldIntercept,
    isKnownLLMUrl: known,
  };
}

/**
 * Resolve the same undici module OpenClaw uses via createRequire(dist/undici-runtime-*.js).
 * @param {string} openclawDir
 * @returns {{ undici: object, resolvedPath: string } | null}
 */
function resolveOpenClawUndiciFromDist(openclawDir) {
  var fs = require('fs');
  var path = require('path');
  var distDir = path.join(openclawDir, 'dist');
  if (!fs.existsSync(distDir)) return null;
  var runtimeFile;
  try {
    runtimeFile = fs
      .readdirSync(distDir)
      .find(function (f) {
        return f.startsWith('undici-runtime-') && f.endsWith('.js');
      });
  } catch {
    return null;
  }
  if (!runtimeFile) return null;
  try {
    var createRequire = require('module').createRequire;
    var req = createRequire(path.join(distDir, runtimeFile));
    var resolvedPath = req.resolve('undici');
    var undici = req('undici');
    if (!undici || typeof undici.fetch !== 'function') return null;
    return { undici: undici, resolvedPath: resolvedPath };
  } catch {
    return null;
  }
}

function resolveActiveRunFilePath(homedirFn) {
  var os = require('os');
  var path = require('path');
  var home = typeof homedirFn === 'function' ? homedirFn() : os.homedir();
  return path.join(home, '.openclaw', 'logs', 'prompt_optimization', 'active_run.json');
}

module.exports = {
  resolveRequestUrl,
  isKnownLLMUrl,
  resolveFetchGates,
  resolveOpenClawUndiciFromDist,
  resolveActiveRunFilePath,
};
