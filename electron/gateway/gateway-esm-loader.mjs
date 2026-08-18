export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'tokenjuice/openclaw' || specifier.endsWith('hosts/openclaw/extension.js')) {
    const resolved = await nextResolve(specifier, context);
    // 加上特定 query 标记以供 load 阶段识别
    return { url: resolved.url + '?intercepted=true', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?intercepted=true')) {
    const realUrl = url.replace('?intercepted=true', '');
    // 动态生成代理模块，不碰源码，仅包装暴露的 API
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        import { createTokenjuiceOpenClawEmbeddedExtension as _orig } from ${JSON.stringify(realUrl)};
        
        export function createTokenjuiceOpenClawEmbeddedExtension() {
          const ext = _orig();
          return function tokenjuiceOpenClawExtension(pi) {
            const origOn = pi.on;
            // 代理 pi (PluginAPI) 实例
            const proxiedPi = Object.create(pi);
            proxiedPi.on = function(event, handler) {
              if (event === "tool_result") {
                return origOn.call(pi, event, async (rawEvent, ctx) => {
                  const contentChars = globalThis.__measureToolResultChars ? globalThis.__measureToolResultChars(rawEvent.content) : 0;
                  const detailsChars = rawEvent.details && typeof rawEvent.details.aggregated === 'string' ? rawEvent.details.aggregated.length : 0;
                  const beforeChars = Math.max(contentChars, detailsChars);
                  const result = await handler(rawEvent, ctx);
                  
                  if (result && globalThis.__recordTokenjuiceStats) {
                    const afterChars = globalThis.__measureToolResultChars ? globalThis.__measureToolResultChars(result.content) : 0;
                    globalThis.__recordTokenjuiceStats(rawEvent.toolName, rawEvent.toolCallId, beforeChars, afterChars);
                  }
                  return result;
                });
              }
              return origOn.call(pi, event, handler);
            };
            return ext(proxiedPi);
          };
        }
      `
    };
  }
  return nextLoad(url, context);
}
