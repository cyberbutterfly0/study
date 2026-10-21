/**
 * markdown.js —— 前端 Markdown 渲染（只用于 AI 回复，笔记正文是构建时预渲染的 HTML）
 *
 * 安全前提：AI 输出属于不可信内容，一律先转义再还原标记，
 * 不允许内联 HTML 直通，链接只放行 http/https。
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function safeUrl(url) {
  const u = String(url).trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(u) ? u : '#';
}

/** 行内标记 */
function inline(text) {
  let s = esc(text);

  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

/** 表格分隔行 |---|---| */
function isTableSep(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * @param {string} md
 * @returns {string} HTML
 */
export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const listStack = [];
  let i = 0;

  const closeLists = () => {
    while (listStack.length) out.push(`</${listStack.pop()}>`);
  };

  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, '');

    // 代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      closeLists();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i++;
      continue;
    }

    // 标题（AI 回复里 h1/h2 降级，避免撑爆气泡）
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const lv = Math.min(6, Math.max(3, h[1].length + 1));
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      closeLists();
      out.push('<hr>');
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && lines[i + 1] && isTableSep(lines[i + 1])) {
      closeLists();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of rows) {
        out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      out.push('</tbody></table></div>');
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join('<br>'))}</blockquote>`);
      continue;
    }

    // 列表
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const tag = ordered ? 'ol' : 'ul';
      const depth = indent >= 2 ? 1 : 0;

      if (listStack.length === 0) {
        out.push(`<${tag}>`);
        listStack.push(tag);
      } else if (depth > 0 && listStack.length === 1) {
        out.push(`<${tag}>`);
        listStack.push(tag);
      } else if (listStack.length > 1 && depth === 0) {
        out.push(`</${listStack.pop()}>`);
      }
      out.push(`<li>${inline(li[3])}</li>`);
      i++;
      continue;
    }

    // 段落
    closeLists();
    const para = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)/.test(lines[i]) &&
      !/^\s*([-*_])\s*\1\s*\1/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join('<br>'))}</p>`);
  }

  closeLists();
  return out.join('\n');
}
