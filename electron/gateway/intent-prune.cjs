'use strict';

/**
 * Agent-layer tool pruning resolver (Track B, enforcement side).
 *
 * Runs inside the gateway process (required by fetch-preload.js), where the real
 * outbound tools array is visible. Given an {@link OptimizationProfile} produced
 * by the renderer's intent-classifier (delivered via the hint sidecar), it maps
 * abstract tool GROUPS to the concrete provider tool ids actually present and
 * decides which tool schemas to drop from the request.
 *
 * Safety invariants (Track B B5):
 * - Core tools are NEVER pruned (matched by substring, naming-robust).
 * - Below the confidence threshold, or with no/!object profile, nothing is pruned.
 * - It never drops the entire tool set (fail-safe to keep-all).
 *
 * Tool-id matching is substring-based and case-insensitive so it tolerates
 * provider/runtime naming variations. The pattern lists below are best-effort
 * and should be reconciled against a real outbound tools array during B4.
 */

var DEFAULT_THRESHOLD = 0.6;

// Cheap, broadly-needed tools that must survive every prune.
var CORE_TOOL_PATTERNS = [
  'read', 'write', 'edit', 'apply_patch',
  'memory', 'message', 'reply', 'send',
  'task', 'todo', 'session', 'finish', 'ask', 'plan',
];

// Abstract group -> substrings matched against a tool id (lowercased).
var GROUP_PATTERNS = {
  search: ['search', 'tavily', 'brave', 'bocha', 'exa', 'web_search'],
  browser: ['browser', 'navigate', 'open_url', 'fetch_url', 'screenshot'],
  fs: ['read', 'write', 'edit', 'apply_patch', 'ls', 'list_dir', 'glob', 'grep', 'file'],
  exec: ['exec', 'bash', 'shell', 'process', 'command', 'run_', 'terminal'],
  office: ['pdf', 'xlsx', 'docx', 'pptx', 'excel', 'spreadsheet', 'word', 'powerpoint', 'sheet'],
  media: ['image', 'banana', 'draw', 'render', 'video', 'music', 'audio', 'tts', 'speech'],
};

function matchesAny(idLower, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    if (idLower.indexOf(patterns[i]) !== -1) return true;
  }
  return false;
}

function isCoreTool(toolId) {
  return matchesAny(String(toolId || '').toLowerCase(), CORE_TOOL_PATTERNS);
}

/**
 * Decide which tool ids to keep/drop for a turn.
 * @param {object} profile - { keepGroups: string[], confidence: number, intent?: string }
 * @param {string[]} availableToolIds - tool ids present in the outbound request
 * @param {{threshold?: number}} [options]
 * @returns {{ keep: string[], drop: string[], pruned: boolean }}
 */
function resolveToolPruning(profile, availableToolIds, options) {
  var threshold = options && typeof options.threshold === 'number' ? options.threshold : DEFAULT_THRESHOLD;
  var ids = Array.isArray(availableToolIds) ? availableToolIds : [];

  // Disabled / low-confidence / malformed profile -> keep everything.
  if (!profile || typeof profile !== 'object' || (Number(profile.confidence) || 0) < threshold) {
    return { keep: ids.slice(), drop: [], pruned: false };
  }

  var keepGroups = Array.isArray(profile.keepGroups) ? profile.keepGroups : [];
  var keepPatterns = [];
  for (var g = 0; g < keepGroups.length; g++) {
    var gp = GROUP_PATTERNS[keepGroups[g]];
    if (gp) keepPatterns = keepPatterns.concat(gp);
  }

  var keep = [];
  var drop = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var idLower = String(id || '').toLowerCase();
    if (isCoreTool(idLower) || matchesAny(idLower, keepPatterns)) {
      keep.push(id);
    } else {
      drop.push(id);
    }
  }

  // Fail-safe: never strip the whole toolset.
  if (keep.length === 0 || drop.length === 0) {
    return { keep: ids.slice(), drop: [], pruned: false };
  }
  return { keep: keep, drop: drop, pruned: true };
}

/**
 * Apply pruning to a tools array (array of objects). Returns a new array
 * containing only kept tools, plus the char sizes before/after for savings
 * measurement. `getToolId` extracts the comparable id from a tool entry.
 * @returns {{ tools: any[], beforeChars: number, afterChars: number, droppedIds: string[] }}
 */
function pruneToolsArray(tools, profile, getToolId, options) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools: tools, beforeChars: 0, afterChars: 0, droppedIds: [] };
  }
  var idOf = typeof getToolId === 'function' ? getToolId : function (t) {
    return t && (t.name || (t.function && t.function.name)) || '';
  };
  var availableIds = tools.map(idOf);
  var decision = resolveToolPruning(profile, availableIds, options);
  var beforeChars = safeJsonLength(tools);
  if (!decision.pruned) {
    return { tools: tools, beforeChars: beforeChars, afterChars: beforeChars, droppedIds: [] };
  }
  var dropSet = {};
  for (var i = 0; i < decision.drop.length; i++) dropSet[decision.drop[i]] = true;
  var kept = tools.filter(function (t) { return !dropSet[idOf(t)]; });
  return {
    tools: kept,
    beforeChars: beforeChars,
    afterChars: safeJsonLength(kept),
    droppedIds: decision.drop,
  };
}

function safeJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

module.exports = {
  DEFAULT_THRESHOLD,
  CORE_TOOL_PATTERNS,
  GROUP_PATTERNS,
  isCoreTool,
  resolveToolPruning,
  pruneToolsArray,
  safeJsonLength,
};
