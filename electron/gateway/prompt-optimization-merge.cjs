'use strict';

var SIDECAR_FILENAME = 'prompt_optimization_tool_results.jsonl';
var CHARS_PER_TOKEN_ESTIMATE = 4;
var MAX_SIDECAR_LINES_SCAN = 2000;

function createSourceBucket() {
  return {
    before_chars: 0,
    after_chars: 0,
    saved_chars: 0,
    events_count: 0,
  };
}

function createOptimizationStats(enabled, protocol) {
  return {
    enabled: enabled,
    protocol: protocol || 'unknown',
    changed: false,
    cache_hits: 0,
    cache_misses: 0,
    total: {
      before_chars: 0,
      after_chars: 0,
      saved_chars: 0,
    },
    by_role: {},
    by_source: {
      request_body: createSourceBucket(),
      tool_result: createSourceBucket(),
    },
    estimated_saved_tokens: 0,
  };
}

function addSourceStats(stats, source, beforeChars, afterChars) {
  if (!stats || !stats.by_source || !stats.by_source[source]) return;
  var bucket = stats.by_source[source];
  bucket.before_chars += beforeChars;
  bucket.after_chars += afterChars;
  bucket.saved_chars = bucket.before_chars - bucket.after_chars;
}

function addRoleStats(stats, role, beforeChars, afterChars) {
  if (!stats || !role) return;
  stats.total.before_chars += beforeChars;
  stats.total.after_chars += afterChars;
  stats.total.saved_chars = stats.total.before_chars - stats.total.after_chars;
  addSourceStats(stats, 'request_body', beforeChars, afterChars);
  if (!stats.by_role[role]) {
    stats.by_role[role] = { before_chars: 0, after_chars: 0, saved_chars: 0 };
  }
  stats.by_role[role].before_chars += beforeChars;
  stats.by_role[role].after_chars += afterChars;
  stats.by_role[role].saved_chars = stats.by_role[role].before_chars - stats.by_role[role].after_chars;
}

function finalizeOptimizationStats(stats) {
  if (!stats || !stats.total) return stats;
  stats.estimated_saved_tokens = Math.max(
    0,
    Math.round((stats.total.saved_chars || 0) / CHARS_PER_TOKEN_ESTIMATE),
  );
  return stats;
}

function resolveSidecarPath(homedirFn) {
  var os = require('node:os');
  var path = require('node:path');
  var home = typeof homedirFn === 'function' ? homedirFn() : os.homedir();
  return path.join(home, '.openclaw', 'logs', 'prompt_optimization', SIDECAR_FILENAME);
}

function mergeToolResultSidecar(stats, options) {
  if (!stats || !stats.by_source) return stats;

  var fs = require('node:fs');
  var path = require('node:path');
  var sidecarPath = resolveSidecarPath(options && options.homedir);
  if (!fs.existsSync(sidecarPath)) {
    return finalizeOptimizationStats(stats);
  }

  var consumed = options && options.consumedIds;
  if (!consumed || typeof consumed.add !== 'function') {
    consumed = new Set();
  }

  var raw = '';
  try {
    raw = fs.readFileSync(sidecarPath, 'utf8');
  } catch {
    return finalizeOptimizationStats(stats);
  }

  var lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length > MAX_SIDECAR_LINES_SCAN) {
    lines = lines.slice(lines.length - MAX_SIDECAR_LINES_SCAN);
  }

  var mergedEvents = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.source !== 'tool_result') continue;
    var id = typeof entry.id === 'string' ? entry.id : '';
    if (id && consumed.has(id)) continue;
    if (id) consumed.add(id);

    var before = Number(entry.before_chars) || 0;
    var after = Number(entry.after_chars) || 0;
    var saved = Number(entry.saved_chars);
    if (!Number.isFinite(saved) || saved < 0) {
      saved = Math.max(0, before - after);
    }
    if (saved <= 0) continue;

    stats.total.before_chars += before;
    stats.total.after_chars += after;
    stats.total.saved_chars = stats.total.before_chars - stats.total.after_chars;
    addSourceStats(stats, 'tool_result', before, after);
    mergedEvents++;
    if (entry.changed === true) stats.changed = true;
  }

  stats.by_source.tool_result.events_count += mergedEvents;
  return finalizeOptimizationStats(stats);
}

module.exports = {
  SIDECAR_FILENAME,
  CHARS_PER_TOKEN_ESTIMATE,
  createOptimizationStats,
  addRoleStats,
  addSourceStats,
  finalizeOptimizationStats,
  mergeToolResultSidecar,
  resolveSidecarPath,
};
