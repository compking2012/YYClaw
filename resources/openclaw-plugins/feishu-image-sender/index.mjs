import { definePluginEntry } from 'openclaw/plugin-sdk/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * feishu-image-sender
 *
 * Provides a `feishu_send_image` agent tool that reliably delivers a locally
 * generated image file to the CURRENT Feishu chat.
 *
 * Why this exists: the native `MEDIA:<path>` outbound path does not reliably
 * upload agent reply media to a Feishu image_key (the reply is dropped /
 * degraded to a `📎 <path>` text link). This tool does the upload+send
 * explicitly via the Feishu OpenAPI, so image delivery no longer depends on the
 * flaky native dispatch:
 *   1. tenant_access_token (app_id/app_secret from config)
 *   2. POST /open-apis/im/v1/images  -> image_key
 *   3. POST /open-apis/im/v1/messages (msg_type=image, {image_key})
 *
 * Target chat + credentials are resolved from the trusted tool context
 * (deliveryContext.to / accountId + config), so the agent only passes the file
 * path. `receive_id` may be supplied explicitly to override.
 */

const FEISHU_BASE = (process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn').replace(/\/+$/, '');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveFeishuApp(config, accountId) {
  const feishu = config?.channels?.feishu;
  if (!feishu) return null;
  const account =
    (accountId && feishu.accounts && feishu.accounts[accountId]) ||
    (feishu.accounts && feishu.accounts.default) ||
    feishu;
  const appId = account?.appId || feishu.appId;
  const appSecret = account?.appSecret || feishu.appSecret;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** Parse a route target ("user:ou_..", "chat:oc_..", raw "ou_.."/"oc_..") into {receive_id, receive_id_type}. */
function parseReceiveTarget(to) {
  if (!to) return null;
  let s = String(to).trim();
  if (!s) return null;
  s = s.replace(/^(feishu|lark):/i, '');
  let id = s;
  let kind = null;
  const m = s.match(/^(user|chat|open_id|chat_id|union_id|user_id|email):(.+)$/i);
  if (m) {
    id = m[2].trim();
    const k = m[1].toLowerCase();
    if (k === 'user' || k === 'open_id') kind = 'open_id';
    else if (k === 'chat' || k === 'chat_id') kind = 'chat_id';
    else kind = k;
  }
  if (!kind) {
    if (/^oc_/.test(id)) kind = 'chat_id';
    else if (/^ou_/.test(id)) kind = 'open_id';
    else if (/^on_/.test(id)) kind = 'union_id';
    else if (id.includes('@')) kind = 'email';
    else kind = 'open_id';
  }
  return { receive_id: id, receive_id_type: kind };
}

async function getTenantToken(app) {
  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json || json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`get tenant_access_token failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.tenant_access_token;
}

async function uploadImage(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([buf]), path.basename(filePath) || 'image');
  const res = await fetch(`${FEISHU_BASE}/open-apis/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  const imageKey = json?.data?.image_key;
  if (!json || json.code !== 0 || !imageKey) {
    throw new Error(`upload image failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return imageKey;
}

async function sendImageMessage(token, target, imageKey) {
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(target.receive_id_type)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: target.receive_id,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    }),
  });
  const json = await res.json().catch(() => ({}));
  const messageId = json?.data?.message_id;
  if (!json || json.code !== 0 || !messageId) {
    throw new Error(`send image message failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return messageId;
}

const PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      description:
        '要发送的本地图片文件的绝对路径（例如 ~/.openclaw/media/outbound/xxx.png）。文件须是有效的 JPEG/PNG/GIF/BMP/WEBP。',
    },
    receive_id: {
      type: 'string',
      description:
        '可选。目标会话/用户 id（open_id ou_... 或 chat_id oc_...）。不传则自动发送到当前对话。',
    },
    receive_id_type: {
      type: 'string',
      description: '可选。open_id / chat_id / union_id / user_id / email；不传则自动推断。',
    },
  },
};

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return {
    content: [{ type: 'text', text }],
    isError: !!(obj && typeof obj === 'object' && obj.success === false),
  };
}

export const pluginEntry = definePluginEntry({
  id: 'feishu-image-sender',
  name: 'Feishu Image Sender',
  description:
    'Send a local image file to the current Feishu chat (uploads to image_key then sends msg_type=image).',
  register(api) {
     
    console.error('[feishu-image-sender] register() called; installing feishu_send_image tool factory');
    api.registerTool((ctx) => {
      const deliveryContext = ctx?.deliveryContext;
       
      console.error(
        `[feishu-image-sender] tool factory invoked: channel=${deliveryContext?.channel ?? '(none)'} to=${deliveryContext?.to ?? '(none)'} accountId=${deliveryContext?.accountId ?? '(none)'}`,
      );
      // Only expose on Feishu conversations. When channel is unknown, still
      // expose it (the agent may pass an explicit receive_id); when it is a
      // different channel, hide it.
      if (deliveryContext?.channel && deliveryContext.channel !== 'feishu') return null;

      return {
        name: 'feishu_send_image',
        label: 'Feishu Send Image',
        description:
          '把一个本地图片文件发送到当前飞书会话：自动上传获得 image_key，并以图片消息（msg_type=image）发出。生成图片后请用此工具把图片发给用户，而不要只在回复里写 MEDIA: 路径。',
        promptSnippet: 'Send a local image file to the current Feishu chat as an inline image.',
        parameters: PARAMS,
        async execute(_toolCallId, params) {
           
          console.error(`[feishu-image-sender] execute() called: path=${params?.path} receive_id=${params?.receive_id ?? '(auto)'}`);
          try {
            const config = ctx.getRuntimeConfig?.() || ctx.runtimeConfig || ctx.config;
            if (!config) return textResult({ success: false, error: 'no runtime config available' });

            const accountId = deliveryContext?.accountId || ctx.agentAccountId || undefined;
            const app = resolveFeishuApp(config, accountId);
            if (!app) {
              return textResult({
                success: false,
                error: '找不到飞书应用凭证（channels.feishu 的 appId/appSecret）',
              });
            }

            const filePath = path.resolve(expandHome(params.path));
            if (!fs.existsSync(filePath)) {
              return textResult({ success: false, error: `图片文件不存在: ${filePath}` });
            }

            let target = params.receive_id
              ? { receive_id: params.receive_id, receive_id_type: params.receive_id_type || null }
              : parseReceiveTarget(deliveryContext?.to);
            if (target && !target.receive_id_type) target = parseReceiveTarget(target.receive_id);
            if (!target || !target.receive_id) {
              return textResult({
                success: false,
                error: '无法确定目标会话 receive_id（当前会话上下文缺失且未传 receive_id）',
              });
            }

            const token = await getTenantToken(app);
            const imageKey = await uploadImage(token, filePath);
            const messageId = await sendImageMessage(token, target, imageKey);
            return textResult({
              success: true,
              message_id: messageId,
              image_key: imageKey,
              receive_id: target.receive_id,
              receive_id_type: target.receive_id_type,
            });
          } catch (err) {
            return textResult({ success: false, error: err && err.message ? err.message : String(err) });
          }
        },
      };
    });
  },
});

export default pluginEntry;
