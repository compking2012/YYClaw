'use strict';
(function () {
  var _f = globalThis.fetch;
  if (typeof _f !== 'function') return;
  if (globalThis.__clawxFetchPatched) return;
  globalThis.__clawxFetchPatched = true;
  console.info('[YYClaw] gateway-fetch-preload active');

  var PROMPT_CACHE_LIMIT = 1500;
  var PROMPT_CACHE_TRIM_COUNT = 300;
  var MAX_NESTED_JSON_DEPTH = 5;
  var promptCache = globalThis.__clawxPromptCache || new Map();
  globalThis.__clawxPromptCache = promptCache;
  var consumedPromptOptIds = globalThis.__clawxConsumedPromptOptIds || new Set();
  globalThis.__clawxConsumedPromptOptIds = consumedPromptOptIds;

  var nodePath = require('path');
  var promptOptMerge;
  try {
    promptOptMerge = require(nodePath.join(nodePath.dirname(__filename), 'prompt-optimization-merge.cjs'));
  } catch (mergeLoadErr) {
    promptOptMerge = null;
  }

  globalThis.__measureToolResultChars = function(content) {
    if (!content) return 0;
    if (typeof content === 'string') return content.length;
    if (!Array.isArray(content)) return 0;
    var total = 0;
    for (var i=0; i<content.length; i++) {
      var block = content[i];
      if (block && typeof block.text === 'string') total += block.text.length;
      if (block && typeof block.content === 'string') total += block.content.length;
      if (block && Array.isArray(block.content)) total += globalThis.__measureToolResultChars(block.content);
    }
    return total;
  };

  globalThis.__recordTokenjuiceStats = function(toolName, toolCallId, beforeChars, afterChars) {
    var saved = beforeChars - afterChars;
    if (saved <= 0) return;
    var entry = {
      id: require('crypto').randomUUID(),
      timestamp: new Date().toISOString(),
      source: "tool_result",
      toolName: toolName || "unknown",
      toolCallId: toolCallId,
      before_chars: beforeChars,
      after_chars: afterChars,
      saved_chars: saved,
      changed: beforeChars !== afterChars
    };
    try {
      var fs = require('fs');
      var sidecarPath = promptOptMerge && typeof promptOptMerge.resolveSidecarPath === 'function' 
        ? promptOptMerge.resolveSidecarPath() 
        : nodePath.join(require('os').homedir(), '.openclaw', 'logs', 'prompt_optimization', 'prompt_optimization_tool_results.jsonl');
      var dir = nodePath.dirname(sidecarPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(sidecarPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
  };

  globalThis.__measureToolResultChars = function(content) {
    if (!content) return 0;
    if (typeof content === 'string') return content.length;
    if (!Array.isArray(content)) return 0;
    var total = 0;
    for (var i=0; i<content.length; i++) {
      var block = content[i];
      if (block && typeof block.text === 'string') total += block.text.length;
      if (block && typeof block.content === 'string') total += block.content.length;
      if (block && Array.isArray(block.content)) total += globalThis.__measureToolResultChars(block.content);
    }
    return total;
  };

  globalThis.__recordTokenjuiceStats = function(toolName, toolCallId, beforeChars, afterChars) {
    var saved = beforeChars - afterChars;
    if (saved <= 0) return;
    var entry = {
      id: require('crypto').randomUUID(),
      timestamp: new Date().toISOString(),
      source: "tool_result",
      toolName: toolName || "unknown",
      toolCallId: toolCallId,
      before_chars: beforeChars,
      after_chars: afterChars,
      saved_chars: saved,
      changed: beforeChars !== afterChars
    };
    try {
      var fs = require('fs');
      var sidecarPath = promptOptMerge && typeof promptOptMerge.resolveSidecarPath === 'function' 
        ? promptOptMerge.resolveSidecarPath() 
        : nodePath.join(require('os').homedir(), '.openclaw', 'logs', 'prompt_optimization', 'prompt_optimization_tool_results.jsonl');
      var dir = nodePath.dirname(sidecarPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(sidecarPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
  };

  function flattenHeaders(headers) {
    var flat = {};
    if (!headers) return flat;
    if (typeof headers.forEach === 'function') {
      headers.forEach(function (v, k) { flat[String(k).toLowerCase()] = String(v); });
    } else if (Array.isArray(headers)) {
      headers.forEach(function (entry) {
        if (entry && entry.length >= 2) flat[String(entry[0]).toLowerCase()] = String(entry[1]);
      });
    } else if (typeof headers === 'object') {
      Object.keys(headers).forEach(function (k) { flat[String(k).toLowerCase()] = String(headers[k]); });
    }
    return flat;
  }

  function simpleHash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash | 0;
    }
    return String(str.length) + ':' + (hash >>> 0).toString(36);
  }

  function createOptimizationStats(enabled, protocol) {
    if (promptOptMerge && typeof promptOptMerge.createOptimizationStats === 'function') {
      return promptOptMerge.createOptimizationStats(enabled, protocol);
    }
    return {
      enabled: enabled,
      protocol: protocol || 'unknown',
      changed: false,
      cache_hits: 0,
      cache_misses: 0,
      total: { before_chars: 0, after_chars: 0, saved_chars: 0 },
      by_role: {},
      by_source: {
        request_body: { before_chars: 0, after_chars: 0, saved_chars: 0, events_count: 0 },
        tool_result: { before_chars: 0, after_chars: 0, saved_chars: 0, events_count: 0 },
      },
      estimated_saved_tokens: 0,
    };
  }

  function addRoleStats(stats, role, beforeChars, afterChars) {
    if (promptOptMerge && typeof promptOptMerge.addRoleStats === 'function') {
      promptOptMerge.addRoleStats(stats, role, beforeChars, afterChars);
      return;
    }
    if (!stats || !role) return;
    stats.total.before_chars += beforeChars;
    stats.total.after_chars += afterChars;
    stats.total.saved_chars = stats.total.before_chars - stats.total.after_chars;
    if (!stats.by_role[role]) {
      stats.by_role[role] = { before_chars: 0, after_chars: 0, saved_chars: 0 };
    }
    stats.by_role[role].before_chars += beforeChars;
    stats.by_role[role].after_chars += afterChars;
    stats.by_role[role].saved_chars = stats.by_role[role].before_chars - stats.by_role[role].after_chars;
  }

  function finalizeDumpOptimization(stats, promptOptimizationEnabled) {
    if (!stats) return stats;
    if (
      promptOptimizationEnabled &&
      promptOptMerge &&
      typeof promptOptMerge.mergeToolResultSidecar === 'function'
    ) {
      return promptOptMerge.mergeToolResultSidecar(stats, { consumedIds: consumedPromptOptIds });
    }
    if (promptOptMerge && typeof promptOptMerge.finalizeOptimizationStats === 'function') {
      return promptOptMerge.finalizeOptimizationStats(stats);
    }
    return stats;
  }

  function trimPromptCacheIfNeeded() {
    if (promptCache.size <= PROMPT_CACHE_LIMIT) return;
    var keys = Array.from(promptCache.keys());
    for (var i = 0; i < Math.min(PROMPT_CACHE_TRIM_COUNT, keys.length); i++) {
      promptCache.delete(keys[i]);
    }
  }

  function findJsonBlockEnd(text, start) {
    var first = text.charAt(start);
    var stack = [first];
    var inString = false;
    var escape = false;
    for (var i = start + 1; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        stack.push(ch);
      } else if (ch === '}' || ch === ']') {
        var expectedOpen = ch === '}' ? '{' : '[';
        if (stack.pop() !== expectedOpen) return -1;
        if (stack.length === 0) return i + 1;
      }
    }
    return -1;
  }

  function minifyNestedJsonStrings(parsed, depth) {
    if (depth >= MAX_NESTED_JSON_DEPTH) return parsed;
    if (typeof parsed === 'string') {
      return minifyJsonStringLossless(parsed, depth + 1);
    }
    if (Array.isArray(parsed)) {
      for (var i = 0; i < parsed.length; i++) {
        parsed[i] = minifyNestedJsonStrings(parsed[i], depth + 1);
      }
      return parsed;
    }
    if (!parsed || typeof parsed !== 'object') return parsed;
    Object.keys(parsed).forEach(function (key) {
      parsed[key] = minifyNestedJsonStrings(parsed[key], depth + 1);
    });
    return parsed;
  }

  function minifyJsonStringLossless(value, depth) {
    if (typeof value !== 'string') return value;
    var currentDepth = depth || 0;
    if (currentDepth >= MAX_NESTED_JSON_DEPTH) return value;
    var start = value.search(/\S/);
    if (start < 0) return value;
    var first = value.charAt(start);
    if (!(first === '{' || first === '[')) return value;
    var end = findJsonBlockEnd(value, start);
    if (end < 0) return value;
    try {
      var parsed = JSON.parse(value.slice(start, end));
      parsed = minifyNestedJsonStrings(parsed, currentDepth);
      return value.slice(0, start) + JSON.stringify(parsed) + value.slice(end);
    } catch (e) {
      return value;
    }
  }

  function optimizeStringContent(value, role, path, stats) {
    if (typeof value !== 'string') return value;
    var beforeChars = value.length;
    if (beforeChars < 2) {
      addRoleStats(stats, role, beforeChars, beforeChars);
      return value;
    }
    var key = [stats.protocol, role || 'unknown', simpleHash(value)].join('|');
    if (promptCache.has(key)) {
      stats.cache_hits++;
      var cached = promptCache.get(key);
      addRoleStats(stats, role, beforeChars, cached.length);
      if (cached !== value) stats.changed = true;
      return cached;
    }
    stats.cache_misses++;
    var optimized = minifyJsonStringLossless(value);
    promptCache.set(key, optimized);
    trimPromptCacheIfNeeded();
    addRoleStats(stats, role, beforeChars, optimized.length);
    if (optimized !== value) stats.changed = true;
    return optimized;
  }

  function optimizeContentBlocks(content, role, path, stats) {
    if (typeof content === 'string') {
      return optimizeStringContent(content, role, path, stats);
    }
    if (!Array.isArray(content)) return content;
    for (var i = 0; i < content.length; i++) {
      var block = content[i];
      if (!block || typeof block !== 'object') continue;
      if (typeof block.text === 'string') {
        block.text = optimizeStringContent(block.text, role, path + '.content[' + i + '].text', stats);
      }
      if (typeof block.content === 'string') {
        block.content = optimizeStringContent(block.content, role, path + '.content[' + i + '].content', stats);
      } else if (Array.isArray(block.content)) {
        block.content = optimizeContentBlocks(block.content, role, path + '.content[' + i + '].content', stats);
      }
    }
    return content;
  }

  function optimizeObjectStrings(value, role, path, stats) {
    if (typeof value === 'string') {
      return optimizeStringContent(value, role, path, stats);
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        value[i] = optimizeObjectStrings(value[i], role, path + '[' + i + ']', stats);
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    Object.keys(value).forEach(function (key) {
      value[key] = optimizeObjectStrings(value[key], role, path + '.' + key, stats);
    });
    return value;
  }

  function detectProtocol(url, body, headers) {
    if (url.indexOf('/responses') !== -1 || (body && Object.prototype.hasOwnProperty.call(body, 'input'))) {
      return 'openai_responses';
    }
    if (
      url.indexOf('/messages') !== -1 &&
      (headers['anthropic-version'] || headers['x-api-key'] || (body && Array.isArray(body.messages) && !Object.prototype.hasOwnProperty.call(body, 'stream_options')))
    ) {
      return 'anthropic_messages';
    }
    if (url.indexOf('/chat/completions') !== -1 || (body && Array.isArray(body.messages))) {
      return 'openai_chat';
    }
    return 'unknown';
  }

  function optimizeOpenAIChatBody(body, stats) {
    if (!body || !Array.isArray(body.messages)) return;
    for (var i = 0; i < body.messages.length; i++) {
      var msg = body.messages[i];
      if (!msg || typeof msg !== 'object') continue;
      var role = msg.role || 'message';
      msg.content = optimizeContentBlocks(msg.content, role, 'messages[' + i + ']', stats);
    }
    if (Array.isArray(body.tools)) {
      body.tools = optimizeObjectStrings(body.tools, 'tools', 'tools', stats);
    }
    if (Array.isArray(body.functions)) {
      body.functions = optimizeObjectStrings(body.functions, 'tools', 'functions', stats);
    }
  }

  function optimizeOpenAIResponsesInput(input, stats, path) {
    if (typeof input === 'string') {
      return optimizeStringContent(input, 'input', path, stats);
    }
    if (!Array.isArray(input)) return input;
    for (var i = 0; i < input.length; i++) {
      var item = input[i];
      if (!item || typeof item !== 'object') continue;
      var role = item.role || item.type || 'input';
      if (typeof item.content === 'string' || Array.isArray(item.content)) {
        item.content = optimizeContentBlocks(item.content, role, path + '[' + i + ']', stats);
      }
      if (typeof item.output === 'string') {
        item.output = optimizeStringContent(item.output, role, path + '[' + i + '].output', stats);
      }
    }
    return input;
  }

  function optimizeOpenAIResponsesBody(body, stats) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'input')) return;
    body.input = optimizeOpenAIResponsesInput(body.input, stats, 'input');
    if (Array.isArray(body.tools)) {
      body.tools = optimizeObjectStrings(body.tools, 'tools', 'tools', stats);
    }
  }

  function optimizeAnthropicBody(body, stats) {
    if (!body) return;
    if (typeof body.system === 'string' || Array.isArray(body.system)) {
      body.system = optimizeContentBlocks(body.system, 'system', 'system', stats);
    }
    if (Array.isArray(body.messages)) {
      for (var i = 0; i < body.messages.length; i++) {
        var msg = body.messages[i];
        if (!msg || typeof msg !== 'object') continue;
        var role = msg.role || 'message';
        msg.content = optimizeContentBlocks(msg.content, role, 'messages[' + i + ']', stats);
      }
    }
    if (Array.isArray(body.tools)) {
      body.tools = optimizeObjectStrings(body.tools, 'tools', 'tools', stats);
    }
  }

  function optimizeRequestBody(body, protocol, stats) {
    if (protocol === 'openai_chat') {
      optimizeOpenAIChatBody(body, stats);
    } else if (protocol === 'openai_responses') {
      optimizeOpenAIResponsesBody(body, stats);
    } else if (protocol === 'anthropic_messages') {
      optimizeAnthropicBody(body, stats);
    }
  }

  function ensureOpenAIStreamUsage(body, protocol) {
    if (protocol !== 'openai_chat' || !body || body.stream !== true) return false;
    body.stream_options = Object.assign({}, body.stream_options || {}, { include_usage: true });
    return true;
  }

  function parseSseEvents(bodyText) {
    if (typeof bodyText !== 'string' || bodyText.indexOf('data:') === -1) return [];
    var events = [];
    var chunks = bodyText.split(/\n\n+/);
    for (var i = 0; i < chunks.length; i++) {
      var lines = chunks[i].split(/\r?\n/);
      var eventName = '';
      var dataLines = [];
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
        if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      var dataText = dataLines.join('\n');
      if (dataText === '[DONE]') continue;
      try {
        events.push({ event: eventName, data: JSON.parse(dataText) });
      } catch (e) {
        // ignore non-JSON SSE chunks
      }
    }
    return events;
  }

  function normalizeUsage(rawUsage, protocol) {
    if (!rawUsage || typeof rawUsage !== 'object') return null;
    var usage = {};
    if (protocol === 'openai_chat') {
      usage.input_tokens = rawUsage.prompt_tokens;
      usage.output_tokens = rawUsage.completion_tokens;
      usage.total_tokens = rawUsage.total_tokens;
    } else {
      usage.input_tokens = rawUsage.input_tokens;
      usage.output_tokens = rawUsage.output_tokens;
      usage.total_tokens = rawUsage.total_tokens;
    }
    if (rawUsage.cache_read_input_tokens != null) usage.cache_read_input_tokens = rawUsage.cache_read_input_tokens;
    if (rawUsage.cache_creation_input_tokens != null) usage.cache_creation_input_tokens = rawUsage.cache_creation_input_tokens;
    if (rawUsage.input_token_details && rawUsage.input_token_details.cached_tokens != null) {
      usage.cache_read_input_tokens = rawUsage.input_token_details.cached_tokens;
    }
    return usage;
  }

  function extractUsageFromResponse(responseBody, protocol) {
    if (responseBody && typeof responseBody === 'object') {
      if (responseBody.usage) return normalizeUsage(responseBody.usage, protocol);
      if (responseBody.response && responseBody.response.usage) return normalizeUsage(responseBody.response.usage, protocol);
    }
    var events = parseSseEvents(responseBody);
    var merged = null;
    for (var i = events.length - 1; i >= 0; i--) {
      var data = events[i].data;
      var usage = null;
      if (data && data.usage) usage = normalizeUsage(data.usage, protocol);
      if (!usage && data && data.response && data.response.usage) usage = normalizeUsage(data.response.usage, protocol);
      if (!usage && data && data.message && data.message.usage) usage = normalizeUsage(data.message.usage, protocol);
      if (!usage) continue;
      if (!merged) merged = {};
      Object.keys(usage).forEach(function (key) {
        if (merged[key] == null && usage[key] != null) merged[key] = usage[key];
      });
    }
    return merged;
  }

  var fetchGates;
  try {
    fetchGates = require(nodePath.join(nodePath.dirname(__filename), 'fetch-preload-gates.cjs'));
  } catch (gatesLoadErr) {
    fetchGates = null;
  }

  function resolveGates(url) {
    if (fetchGates && typeof fetchGates.resolveFetchGates === 'function') {
      return fetchGates.resolveFetchGates(process.env, url);
    }
    var promptOptimizationEnabled = process.env.CLAWX_PROMPT_OPTIMIZATION_ENABLED === '1';
    var devDumpEnabled = process.env.CLAWX_DEV_MODE_UNLOCKED === '1';
    var known = (
      url.indexOf('/chat/completions') !== -1 ||
      url.indexOf('/responses') !== -1 ||
      url.indexOf('/messages') !== -1 ||
      url.indexOf('generativelanguage') !== -1
    );
    return {
      shouldOptimize: promptOptimizationEnabled,
      shouldDump: promptOptimizationEnabled && devDumpEnabled,
      shouldIntercept: promptOptimizationEnabled && known,
    };
  }

  function hostApiRequest(method, apiPath, body) {
    var baseUrl = process.env.CLAWX_HOST_API_URL;
    var token = process.env.CLAWX_HOST_API_TOKEN;
    if (!baseUrl || !token) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        var http = require('http');
        var urlMod = require('url');
        var parsed = urlMod.parse(baseUrl + apiPath);
        var payload = body ? JSON.stringify(body) : '';
        var req = http.request({
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          method: method,
          headers: (function () {
            var h = {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
            };
            if (payload) h['Content-Length'] = Buffer.byteLength(payload);
            return h;
          })(),
        }, function (res) {
          var chunks = [];
          res.on('data', function (chunk) { chunks.push(chunk); });
          res.on('end', function () {
            var text = Buffer.concat(chunks).toString('utf8');
            if (!text) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(null);
            }
          });
        });
        req.on('error', function (err) {
          console.warn('[YYClaw Preload] Host API error:', err.message);
          resolve(null);
        });
        if (payload) req.write(payload);
        req.end();
      } catch (err) {
        console.warn('[YYClaw Preload] Host API request failed:', err);
        resolve(null);
      }
    });
  }

  function readActiveRunIdFromFile() {
    if (!fetchGates || typeof fetchGates.resolveActiveRunFilePath !== 'function') return null;
    try {
      var fs = require('fs');
      var filePath = fetchGates.resolveActiveRunFilePath();
      if (!fs.existsSync(filePath)) return null;
      var parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && parsed.runId ? String(parsed.runId) : null;
    } catch {
      return null;
    }
  }

  function postOptimizationRecord(runId, total) {
    if (!runId) return Promise.resolve();
    return hostApiRequest('POST', '/api/prompt-optimization/record', {
      runId: runId,
      before_chars: total.before_chars || 0,
      after_chars: total.after_chars || 0,
      saved_chars: total.saved_chars || 0,
    }).then(function (resp) {
      if (resp && resp.success === false) {
        console.warn('[YYClaw Preload] record optimization rejected for runId=' + runId);
      }
    });
  }

  function recordOptimizationToHost(optimization) {
    if (!optimization || !optimization.total) return Promise.resolve();
    var total = optimization.total;
    var runIdFromFile = readActiveRunIdFromFile();
    if (runIdFromFile) {
      return postOptimizationRecord(runIdFromFile, total).catch(function (err) {
        console.warn('[YYClaw Preload] Failed to record optimization stats (file runId):', err);
      });
    }
    return hostApiRequest('GET', '/api/prompt-optimization/active-run').then(function (activeResp) {
      var runId = activeResp && activeResp.active && activeResp.active.runId;
      if (!runId) {
        console.warn('[YYClaw Preload] No active run for optimization record');
        return;
      }
      return postOptimizationRecord(runId, total);
    }).catch(function (err) {
      console.warn('[YYClaw Preload] Failed to record optimization stats:', err);
    });
  }

  var devDiagEnabled = process.env.CLAWX_DEV_MODE_UNLOCKED === '1';

  function logInterceptDiag(url, shouldDump, dumpOptimization) {
    if (!devDiagEnabled || !dumpOptimization || !dumpOptimization.total) return;
    console.info(
      '[YYClaw Preload] llm intercept url=' + url
        + ' shouldDump=' + (shouldDump ? '1' : '0')
        + ' saved=' + (dumpOptimization.total.saved_chars || 0)
        + '/' + (dumpOptimization.total.before_chars || 0),
    );
  }

  function writeLlmDump(dumpData) {
    var fs = require('fs');
    var path = require('path');
    var os = require('os');
    var dumpDir = path.join(os.homedir(), '.openclaw', 'logs', 'llm_dump');
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true });
    }
    var filename = new Date().toISOString().replace(/:/g, '-') + '-' + Math.random().toString(36).substring(2, 8) + '.json';
    var filepath = path.join(dumpDir, filename);
    fs.writeFile(filepath, JSON.stringify(dumpData, null, 2), function (err) {
      if (err) {
        console.warn('[YYClaw Preload] Failed to write LLM dump:', err);
        return;
      }
      if (devDiagEnabled) {
        console.info('[YYClaw Preload] llm dump written path=' + filepath);
      }
    });
  }

  function resolveRequestUrl(input) {
    if (fetchGates && typeof fetchGates.resolveRequestUrl === 'function') {
      return fetchGates.resolveRequestUrl(input);
    }
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
    return '';
  }

  function runClawxFetch(nativeFetch, input, init) {
      var url = resolveRequestUrl(input);

      var gates = resolveGates(url);
      var shouldOptimize = gates.shouldOptimize;
      var shouldDump = gates.shouldDump;
      var shouldIntercept = gates.shouldIntercept;

      var requestBody = null;
      var requestHeaders = null;
      var protocol = 'unknown';
      var optimization = null;

      if (shouldIntercept) {
        try {
          requestHeaders = init && init.headers ? init.headers : {};
          var flatHeaders = flattenHeaders(requestHeaders);
          if (init && init.body) {
            if (typeof init.body === 'string') {
              try {
                requestBody = JSON.parse(init.body);
                protocol = detectProtocol(url, requestBody, flatHeaders);
                optimization = createOptimizationStats(shouldOptimize, protocol);
                if (shouldOptimize && requestBody && typeof requestBody === 'object') {
                  optimizeRequestBody(requestBody, protocol, optimization);
                  if (ensureOpenAIStreamUsage(requestBody, protocol)) {
                    optimization.changed = true;
                  }
                  init = Object.assign({}, init, { body: JSON.stringify(requestBody) });
                }
              } catch (e) {
                requestBody = init.body;
              }
            } else {
              requestBody = '[Non-string body]';
            }
          }
        } catch (e) {
          console.warn('[YYClaw Preload] Failed to parse request body:', e);
        }
      }

      if (url.indexOf('openrouter.ai') !== -1) {
        init = init ? Object.assign({}, init) : {};
        var prev = init.headers;
        var flat = {};
        if (prev && typeof prev.forEach === 'function') {
          prev.forEach(function (v, k) { flat[k] = v; });
        } else if (prev && typeof prev === 'object') {
          Object.assign(flat, prev);
        }
        delete flat['http-referer'];
        delete flat['HTTP-Referer'];
        delete flat['x-title'];
        delete flat['X-Title'];
        flat['HTTP-Referer'] = 'https://claw-x.com';
        flat['X-Title'] = 'YYClaw';
        init.headers = flat;
      }

      var fetchPromise = nativeFetch.call(globalThis, input, init);

      if (shouldIntercept) {
        fetchPromise = fetchPromise.then(function (response) {
          try {
            var clonedResponse = response.clone();
            clonedResponse.text().then(function (bodyText) {
              var responseBody = bodyText;
              try {
                responseBody = JSON.parse(bodyText);
              } catch (e) {
                // keep as string
              }
              var usage = extractUsageFromResponse(responseBody, protocol);
              var dumpOptimization = finalizeDumpOptimization(optimization, shouldOptimize);
              logInterceptDiag(url, shouldDump, dumpOptimization);

              if (shouldOptimize) {
                recordOptimizationToHost(dumpOptimization).catch(function (err) {
                  console.warn('[YYClaw Preload] Failed to record optimization stats:', err);
                });
              }

              if (shouldDump) {
                writeLlmDump({
                  timestamp: new Date().toISOString(),
                  url: url,
                  request: {
                    headers: requestHeaders,
                    body: requestBody,
                    optimization: dumpOptimization,
                  },
                  response: {
                    status: response.status,
                    statusText: response.statusText,
                    body: responseBody,
                    usage: usage,
                  },
                });
              }
            }).catch(function (e) {
              console.warn('[YYClaw Preload] Failed to read cloned response body:', e);
            });
          } catch (e) {
            console.warn('[YYClaw Preload] Failed to clone response:', e);
          }
          return response;
        });
      }

      return fetchPromise;
  }

  globalThis.fetch = function clawxFetch(input, init) {
    return runClawxFetch(_f, input, init);
  };

  (function installOpenClawUndiciRuntimeDeps() {
    var OPENCLAW_UNDICI_RUNTIME_DEPS_KEY = '__OPENCLAW_TEST_UNDICI_RUNTIME_DEPS__';
    var openclawDir = process.env.CLAWX_OPENCLAW_DIR || process.cwd();
    var resolved =
      fetchGates && typeof fetchGates.resolveOpenClawUndiciFromDist === 'function'
        ? fetchGates.resolveOpenClawUndiciFromDist(openclawDir)
        : null;
    if (!resolved) {
      console.warn(
        '[YYClaw] undici runtime deps override skipped (openclawDir=' + openclawDir + ')',
      );
      return;
    }
    var nativeUndiciFetch = resolved.undici.fetch;
    resolved.undici.fetch = function undiciClawxFetch(input, init) {
      return runClawxFetch(nativeUndiciFetch, input, init);
    };
    globalThis[OPENCLAW_UNDICI_RUNTIME_DEPS_KEY] = {
      Agent: resolved.undici.Agent,
      EnvHttpProxyAgent: resolved.undici.EnvHttpProxyAgent,
      FormData: resolved.undici.FormData,
      ProxyAgent: resolved.undici.ProxyAgent,
      fetch: resolved.undici.fetch,
    };
    console.info('[YYClaw] undici runtime deps override resolved=' + resolved.resolvedPath);
  })();

  // --- FS Crypto Preload ---
  var fs = require('fs');
  var crypto = require('crypto');
  
  var ENCRYPTED_MAGIC = 'CLAWX_ENCRYPTED_v1:';
  var ALGORITHM = 'aes-256-gcm';
  var configKeyHex = process.env.OPENCLAW_CONFIG_KEY;
  
  function decryptContent(contentStr) {
    if (!configKeyHex || configKeyHex.length !== 64 || !contentStr.startsWith(ENCRYPTED_MAGIC)) {
      return contentStr;
    }
    try {
      var parts = contentStr.substring(ENCRYPTED_MAGIC.length).split(':');
      if (parts.length !== 3) return contentStr;
      
      var ivHex = parts[0];
      var authTagHex = parts[1];
      var ciphertextHex = parts[2];
      
      var key = Buffer.from(configKeyHex, 'hex');
      var iv = Buffer.from(ivHex, 'hex');
      var authTag = Buffer.from(authTagHex, 'hex');
      
      var decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      
      var decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (e) {
      console.warn('[YYClaw Preload] Failed to decrypt file:', e);
      return contentStr;
    }
  }

  // Hook fs.readFileSync
  var originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function(path, options) {
    var result = originalReadFileSync.apply(this, arguments);
    var isString = typeof result === 'string';
    var isBuffer = Buffer.isBuffer(result);
    
    if (isString || isBuffer) {
      var strContent = isBuffer ? result.toString('utf8') : result;
      if (strContent.startsWith(ENCRYPTED_MAGIC)) {
        var decryptedStr = decryptContent(strContent);
        if (isBuffer && (!options || !options.encoding)) {
             return Buffer.from(decryptedStr, 'utf8');
        }
        return decryptedStr;
      }
    }
    return result;
  };
  
  // Hook fs.readFile
  var originalReadFile = fs.readFile;
  fs.readFile = function() {
    var args = Array.prototype.slice.call(arguments);
    var callback = args.pop();
    
    if (typeof callback !== 'function') {
        return originalReadFile.apply(this, arguments);
    }
    
    args.push(function(err, result) {
      if (err || !result) {
        return callback(err, result);
      }
      
      var isString = typeof result === 'string';
      var isBuffer = Buffer.isBuffer(result);
      
      if (isString || isBuffer) {
        var strContent = isBuffer ? result.toString('utf8') : result;
        if (strContent.startsWith(ENCRYPTED_MAGIC)) {
          var decryptedStr = decryptContent(strContent);
          // If the original request didn't specify an encoding, it expects a Buffer back
          var options = args.length > 1 ? args[1] : null;
          var expectsBuffer = !options || (typeof options === 'object' && !options.encoding) || (typeof options === 'string' && options === '');
          
          if (isBuffer && expectsBuffer) {
             return callback(null, Buffer.from(decryptedStr, 'utf8'));
          } else {
             return callback(null, decryptedStr);
          }
        }
      }
      return callback(err, result);
    });
    
    originalReadFile.apply(this, args);
  };
  
  // Hook fs.promises.readFile if it exists
  if (fs.promises && fs.promises.readFile) {
    var originalPromisesReadFile = fs.promises.readFile;
    fs.promises.readFile = function() {
       var args = arguments;
       return originalPromisesReadFile.apply(this, args).then(function(result) {
          var isString = typeof result === 'string';
          var isBuffer = Buffer.isBuffer(result);
          
          if (isString || isBuffer) {
            var strContent = isBuffer ? result.toString('utf8') : result;
            if (strContent.startsWith(ENCRYPTED_MAGIC)) {
               var decryptedStr = decryptContent(strContent);
               // Check if options didn't specify encoding (expects buffer)
               var options = args.length > 1 ? args[1] : null;
               var expectsBuffer = !options || (typeof options === 'object' && !options.encoding) || (typeof options === 'string' && options === '');
               
               if (isBuffer && expectsBuffer) {
                  return Buffer.from(decryptedStr, 'utf8');
               }
               return decryptedStr;
            }
          }
          return result;
       });
    };
  }

  if (process.platform === 'win32') {
    try {
      var cp = require('child_process');
      if (!cp.__clawxPatched) {
        cp.__clawxPatched = true;
        ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync'].forEach(function(method) {
          var original = cp[method];
          if (typeof original !== 'function') return;
          cp[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            var optIdx = -1;
            for (var i = 1; i < args.length; i++) {
              var a = args[i];
              if (a && typeof a === 'object' && !Array.isArray(a)) {
                optIdx = i;
                break;
              }
            }
            if (optIdx >= 0) {
              args[optIdx].windowsHide = true;
            } else {
              var opts = { windowsHide: true };
              if (typeof args[args.length - 1] === 'function') {
                args.splice(args.length - 1, 0, opts);
              } else {
                args.push(opts);
              }
            }
            return original.apply(this, args);
          };
        });
      }
    } catch (e) {
      // ignore
    }
  }
})();
