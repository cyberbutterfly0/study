/**
 * ai.js —— DeepSeek 客户端
 *
 * 浏览器直连 api.deepseek.com（已验证其 CORS 允许任意 Origin + authorization 头），
 * 所以不需要自建后端。代价是 API key 存在本机浏览器里，页面被 XSS 就能读走；
 * 这个 app 不加载任何第三方脚本，风险可控。
 */

/** 把 HTTP 错误翻译成能看懂的中文 */
function describeError(status, body) {
  const detail = (() => {
    try {
      const j = JSON.parse(body);
      return j?.error?.message || j?.message || body;
    } catch {
      return body;
    }
  })();

  switch (status) {
    case 400:
      return `请求格式有问题（400）。${detail || ''}`;
    case 401:
      return 'API Key 无效或已失效（401）。请到「配置」页重新填写。';
    case 402:
      return '账户余额不足（402）。请到 DeepSeek 平台充值。';
    case 403:
      return `没有权限（403）。${detail || ''}`;
    case 404:
      return '接口地址不对（404）。检查 Base URL 是否填成了 /v1 结尾或缺了协议头。';
    case 429:
      return '请求太频繁被限流（429），等几秒再发。';
    case 500:
    case 502:
    case 503:
      return `DeepSeek 服务端出问题（${status}），过会儿再试。`;
    default:
      return `请求失败（${status}）。${detail || ''}`;
  }
}

/**
 * 流式对话。
 * @param {object}   opts
 * @param {Array}    opts.messages   [{role, content}]
 * @param {object}   opts.settings   {baseUrl, model, apiKey}
 * @param {Function} opts.onDelta    (text) => void        增量文本
 * @param {Function} [opts.onReasoning] (text) => void     reasoner 模型的思考过程
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} 完整回复文本
 */
export async function streamChat({ messages, settings, onDelta, onReasoning, signal }) {
  const base = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const key = (settings.apiKey || '').trim();

  if (!key) throw new Error('还没填 API Key，先去「配置」页填上');

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: settings.model || 'deepseek-chat',
        messages,
        stream: true,
        temperature: 1.0,
      }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上 DeepSeek：检查手机网络；如果开了代理/加速器，先关掉试试。');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(describeError(res.status, body));
  }

  if (!res.body) {
    // 极老浏览器没有流式支持，退回整体读取
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content || '';
    onDelta?.(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let reasoning = '';
  let finished = false;

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 以空行分隔事件；逐条切出来处理，最后一段可能不完整，留在 buffer
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          finished = true;
          break;
        }
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta || {};
          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onReasoning?.(delta.reasoning_content);
          }
          if (delta.content) {
            full += delta.content;
            onDelta?.(delta.content);
          }
        } catch {
          // 单条 SSE 解析失败不影响整体
        }
      }
      if (finished) break;
    }
  }

  if (!full.trim() && reasoning.trim()) {
    // reasoner 有时思考完就断了，把思考内容兜底返回
    return reasoning;
  }

  return full;
}

/** 配置页的「测试连接」：发一个最小请求，验证 key / 地址 / 模型都对 */
export async function testConnection(settings) {
  const base = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const key = (settings.apiKey || '').trim();
  if (!key) throw new Error('还没填 API Key');

  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.model || 'deepseek-chat',
        messages: [{ role: 'user', content: '回复一个字：好' }],
        max_tokens: 8,
        stream: false,
      }),
    });
  } catch {
    throw new Error('连不上服务器：检查网络，或 Base URL 填错了');
  }

  const body = await res.text();
  if (!res.ok) throw new Error(describeError(res.status, body));

  let reply = '';
  try {
    reply = JSON.parse(body)?.choices?.[0]?.message?.content || '';
  } catch {
    /* 忽略 */
  }
  return { ms: Date.now() - started, reply: reply.trim() };
}

/** 各模型的能力差异，配置页用来给提示 */
export const MODELS = [
  { id: 'deepseek-chat', name: 'deepseek-chat', desc: '通用对话，快、便宜，日常问答够用' },
  { id: 'deepseek-reasoner', name: 'deepseek-reasoner', desc: '深度推理，慢、贵，适合啃原理和算逻辑' },
];
