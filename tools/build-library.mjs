#!/usr/bin/env node
/**
 * build-library.mjs
 *
 * 把「总结/」下所有 Markdown 转成 app 里可离线阅读的 HTML 片段，
 * 输出 app/data/library.json（按学科 → 章节分组）。
 *
 * 为什么自己写渲染而不直接嵌现有的 _阅读版/*.html：
 *   阅读版是整页 HTML，带自己的样式，塞进 app 只能用 iframe，双层滚动、
 *   主题不跟 app 走。这里只产「正文片段」，样式由 app 统一控制。
 *
 * 支持的 Markdown 子集（够学习笔记用，不做通用解析器）：
 *   标题 #~####、段落、粗体/斜体/行内代码/删除线、链接、图片、
 *   无序/有序列表（含一层嵌套）、表格、围栏代码块、引用、分割线、任务列表。
 *
 * 用法：node tools/build-library.mjs
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, '总结');
const OUT_FILE = path.join(ROOT, 'app', 'data', 'library.json');

const SKIP_DIRS = new Set(['_阅读版', '_暂存', '_trash', '.dsh', '.git', 'node_modules']);

// 这些文件是主题的辅助页，不算「章节」，但还是有阅读价值，归到「附录」
const AUX_TITLES = {
  '错题本': '错题本',
  '术语表': '术语表',
  '平台对照': '平台对照',
};

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内元素渲染。先转义，再按固定顺序替换，避免互相污染。 */
function inline(text) {
  let s = esc(text);

  // 行内代码优先占位，避免里面的 * _ [ 被当成标记
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // 图片 ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    return `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`;
  });

  // 链接 [text](href)
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, text2, href, title) => {
    return `<a href="${href}"${title ? ` title="${title}"` : ''}>${text2}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

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
 * Markdown → HTML 片段。
 * 返回 { html, title, headings }，headings 用于章节内锚点导航。
 */
function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  const headings = [];
  let i = 0;
  let title = '';

  const closeList = (stack) => {
    while (stack.length) out.push(`</${stack.pop()}>`);
  };

  const listStack = [];   // 记录 ul/ol 嵌套

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');

    // 围栏代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      closeList(listStack);
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      out.push(`<pre><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      closeList(listStack);
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(listStack);
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1 && !title) title = text.replace(/[#*`]/g, '').trim();
      const id = 'h-' + headings.length;
      headings.push({ id, level, text: text.replace(/[#*`]/g, '').trim() });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      closeList(listStack);
      out.push('<hr>');
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && lines[i + 1] && isTableSep(lines[i + 1])) {
      closeList(listStack);
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push('<div class="table-wrap"><table>');
      out.push('<thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
      if (rows.length) {
        out.push('<tbody>');
        for (const r of rows) {
          out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
        }
        out.push('</tbody>');
      }
      out.push('</table></div>');
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      closeList(listStack);
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join('<br>'))}</blockquote>`);
      continue;
    }

    // 列表（支持一层嵌套）
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

      let content = li[3];
      // 任务列表
      const task = content.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        content = `<span class="task ${checked ? 'done' : ''}">${checked ? '✓' : '○'}</span> ${inline(task[2])}`;
      } else {
        content = inline(content);
      }
      out.push(`<li>${content}</li>`);
      i++;
      continue;
    }

    // 段落：吸收连续非空行
    closeList(listStack);
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```))/.test(lines[i]) &&
      !/^\s*([-*_])\s*\1\s*\1/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join('<br>'))}</p>`);
  }

  closeList(listStack);
  return { html: out.join('\n'), title, headings };
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function fmtSize(n) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

async function main() {
  const files = await walk(SRC_DIR);
  if (!files.length) {
    console.error('总结/ 下没有找到 Markdown');
    process.exit(1);
  }
  files.sort((a, b) => a.localeCompare(b, 'zh'));

  const subjects = new Map();   // 学科 → 章节[]
  let totalChars = 0;

  for (const file of files) {
    const relPath = path.relative(ROOT, file).split(path.sep).join('/');
    const relInSrc = path.relative(SRC_DIR, file).split(path.sep);
    const baseName = path.basename(file, '.md');

    // 跳过索引类文件
    if (/^(INDEX|README)$/i.test(baseName)) continue;

    const md = await readFile(file, 'utf8');
    const { html, title, headings } = renderMarkdown(md);
    if (!html.trim()) continue;

    const subjectName = relInSrc.length > 1 ? relInSrc[0] : '其他';
    if (!subjects.has(subjectName)) subjects.set(subjectName, []);

    const isAux = Object.prototype.hasOwnProperty.call(AUX_TITLES, baseName);
    const isOverview = baseName === subjectName;            // 与学科目录同名的总览
    const chapterNo = baseName.match(/^第(\d+)章/);
    const isChapter = Boolean(chapterNo);

    subjects.get(subjectName).push({
      id: relPath.replace(/^总结\//, '').replace(/\.md$/, ''),
      name: AUX_TITLES[baseName] || title || baseName,
      file: baseName,
      kind: isOverview ? 'overview' : isAux ? 'appendix' : isChapter ? 'chapter' : 'note',
      // 总览最前 → 第N章按编号 → 其他笔记 → 附录最后
      order: isOverview
        ? -10
        : isAux
          ? 900 + Object.keys(AUX_TITLES).indexOf(baseName)
          : isChapter
            ? Number(chapterNo[1])
            : 500,
      chars: md.length,
      html,
      headings,
    });
    totalChars += md.length;
  }

  const subjectList = [];
  for (const [name, sections] of subjects) {
    sections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name, 'zh');
    });
    subjectList.push({ id: name, name, sections });
  }
  subjectList.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalChars,
    subjects: subjectList,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(OUT_FILE, json, 'utf8');

  console.log(`✓ 生成阅读库 → ${path.relative(ROOT, OUT_FILE).split(path.sep).join('/')}（${fmtSize(Buffer.byteLength(json))}）`);
  for (const s of subjectList) {
    console.log(`  ${s.name}：` + s.sections.map((x) => `${x.name}(${Math.round(x.chars / 1000)}k字)`).join('，'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
