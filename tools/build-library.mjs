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
  // 少数几个白名单 HTML 标签原样放行（<br>、<details>/<summary> 折叠块），先占位防被 esc 掉
  const KEEP = [];
  const keep = (html) => {
    KEEP.push(html);
    return `\u0000K${KEEP.length - 1}\u0000`;
  };
  let s = String(text)
    .replace(/<br\s*\/?>/gi, () => keep('<br>'))
    .replace(/<\/?(?:details|summary)\b[^>]*>/gi, (m) => keep(m));

  s = esc(s);

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
  s = s.replace(/\u0000K(\d+)\u0000/g, (_, i) => KEEP[Number(i)]);
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
/**
 * 阅读版不展示选择题——题目和答案都带「判定」，直接读会剧透。
 * 把「**选择题**」到下一个章节标记之间整段摘掉，换成一句提示。
 */
function stripQuiz(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  const END = /^(?:#{1,6}\s|\*\*(?:答题记录|实践任务|本章易错点|本章小结)\*\*)/;
  let inQuiz = false;
  let count = 0;

  const tip = () => {
    out.push('');
    out.push(`> 本节有 ${count} 道选择题，点右上角「刷题」练习（阅读页不显示答案）。`);
    out.push('');
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (/^\*\*选择题\*\*\s*$/.test(t)) {
      inQuiz = true;
      count = 0;
      continue;
    }
    if (inQuiz) {
      if (END.test(t)) {
        inQuiz = false;
        tip();
        if (t) out.push(raw);
        continue;
      }
      if (/^\d+\.\s/.test(t)) count++;
      continue;
    }
    out.push(raw);
  }
  if (inQuiz) tip();
  return out.join('\n');
}

/**
 * 把一章按小节拆开，让阅读页一节一页，而不是三十多 K 字一屏。
 * 规则：
 *   - 文件头 + `## 本章目标` → 「概览」
 *   - `## 小节` 下面的每个 `### X.Y` → 各自一节（标题就是小节名）
 *   - `## 本章易错点` / `## 本章小结` → 合并成「易错点与小结」
 * 只有拆出 3 节以上才真的拆，否则当普通单页处理。
 */
function splitChapterSections(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let cur = { name: '本章目标', buf: [] };
  let inSections = false;
  let inTail = false;

  const push = () => {
    const body = cur.buf.join('\n').trim();
    if (body) out.push({ name: cur.name, md: body });
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);

    if (h2) {
      const t = h2[1];
      if (/^本章(易错点|小结)/.test(t)) {
        if (!inTail) {
          push();
          cur = { name: '易错点与小结', buf: [] };
          inTail = true;
          inSections = false;
        }
        cur.buf.push(line);
      } else if (/^小节$/.test(t)) {
        inSections = true;          // 这个标题本身不输出，只是个分节开关
      } else {
        cur.buf.push(line);         // 本章目标之类留在「概览」里
      }
      continue;
    }

    if (inSections && h3) {
      push();
      // 小节标题不进正文（页面 header 已经显示），只留内容
      cur = { name: h3[1], buf: [] };
      continue;
    }

    cur.buf.push(line);
  }
  push();
  return out;
}

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
      // 「### #1 xxx」这类条目额外挂稳定锚点 item-N：速查表里的「详情 #N」链接用它，
      // 标题文字以后改了也不会断（阅读版 build-reader.ps1 用的是同一套约定）。
      const itemNo = text.match(/^#(\d+)\s/);
      const anchor = itemNo ? `<span class="anchor" id="item-${itemNo[1]}"></span>` : '';
      out.push(`<h${level} id="${id}">${anchor}${inline(text)}</h${level}>`);
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

  // 页内锚点收尾：md 里手写的是 #item-N 和 #标题文字（如「回: #速查表」），
  // 而标题 id 是自动生成的 h-N。这里把 #标题文字 的链接映射到对应的 h-N；
  // #item-N 原样保留（标题处已经挂了同名 span）。不处理的话 app 里点了会改
  // location.hash，被 hash 路由当成未知页面 → 表现为「点了回到首页」。
  let html = out.join('\n');
  const byLabel = new Map(headings.map((x) => [x.text, x.id]));
  html = html.replace(/href="#([^"]+)"/g, (full, frag) => {
    if (/^(h-|item-)/.test(frag)) return full;
    let label = frag;
    try { label = decodeURIComponent(frag); } catch { /* 非法转义就按原样找 */ }
    const id = byLabel.get(label);
    return id ? `href="#${id}"` : full;
  });

  return { html, title, headings };
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

// ---------------------------------------------------------------- 术语标注

/** 解析 术语表.md：## 分类 下的三列表 → [{term, meaning, plain, cat}] */
function parseGlossary(md) {
  const terms = [];
  let cat = '';
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      cat = h2[1].trim();
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | 术语 | 含义 | 通俗解释 |  →  ['', 术语, 含义, 通俗解释, '']
    if (cells.length < 5) continue;
    const term = cells[1];
    if (!term || term === '术语' || /^:?-{2,}/.test(term) || /^:?-{2,}/.test(cells[2])) continue;
    terms.push({
      term: term.replace(/`/g, ''),
      meaning: cells[2].replace(/`/g, ''),
      plain: (cells[3] || cells[2]).replace(/`/g, ''),
      cat,
    });
  }
  return terms;
}

/** 一个术语可以被哪些写法命中（去掉括号注释，拆开「A / B」这种别名） */
function termKeys(t) {
  const base = String(t.term).replace(/（[^）]*）/g, '').trim();
  const keys = new Set([base]);
  for (const part of base.split(/\s*\/\s*/)) {
    const p = part.trim();
    if (p.length >= 2) keys.add(p);
  }
  return [...keys].filter((k) => k.length >= 2);
}

function plainTextOf(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function renderTermBlock(list) {
  const items = list
    .map(
      (t) =>
        `<div class="ti-item"><b>${esc(t.term)}</b><span>${esc(t.plain || t.meaning)}</span></div>`
    )
    .join('');
  return `<section class="term-inline"><div class="ti-head">本小节术语</div>${items}</section>`;
}

/**
 * 在每个 <h2> 小节末尾插一段「本小节术语」，并返回整页涉及到的术语（去重）给底部速查用。
 * 没有 <h2> 的页面只在正文里扫一遍，不插块。
 */
function annotateTerms(html, terms) {
  if (!terms.length) return { html, used: [] };

  const marks = [...html.matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/g)];
  const used = new Map();

  if (!marks.length) {
    // 没有 ## 小节的页面（如拆出来的单节正文），就在文末挂一个整页术语块
    const text = plainTextOf(html);
    const hits = [];
    for (const t of terms) {
      const pos = Math.min(
        ...termKeys(t)
          .map((k) => text.indexOf(k))
          .filter((p) => p >= 0)
      );
      if (Number.isFinite(pos)) hits.push({ t, pos });
    }
    hits.sort((a, b) => a.pos - b.pos);
    for (const t of terms) {
      if (hits.some((h) => h.t === t)) used.set(t.term, t);
    }
    const picked = hits.slice(0, 10).map((h) => h.t);
    return {
      html: picked.length ? html + renderTermBlock(picked) : html,
      used: [...used.values()],
    };
  }

  let out = html.slice(0, marks[0].index);
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const headEnd = start + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    const body = html.slice(headEnd, end);
    const text = plainTextOf(body);

    const hits = [];
    for (const t of terms) {
      const pos = Math.min(
        ...termKeys(t)
          .map((k) => text.indexOf(k))
          .filter((p) => p >= 0)
      );
      if (Number.isFinite(pos)) hits.push({ t, pos });
    }
    hits.sort((a, b) => a.pos - b.pos);

    const picked = hits.slice(0, 8).map((h) => h.t);
    out += html.slice(start, headEnd) + body;
    if (picked.length) {
      for (const t of picked) used.set(t.term, t);
      out += renderTermBlock(picked);
    }
  }
  return { html: out, used: [...used.values()] };
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

  // 先全部读进来：术语表要给同学科的其他页面做标注，得先拿到
  const mdCache = new Map();
  for (const f of files) mdCache.set(f, await readFile(f, 'utf8'));

  const glossaryBySubject = new Map();
  for (const f of files) {
    if (path.basename(f, '.md') !== '术语表') continue;
    const relInSrc = path.relative(SRC_DIR, f).split(path.sep);
    const subj = relInSrc.length > 1 ? relInSrc[0] : '其他';
    glossaryBySubject.set(subj, parseGlossary(mdCache.get(f)));
  }

  for (const file of files) {
    const relPath = path.relative(ROOT, file).split(path.sep).join('/');
    const relInSrc = path.relative(SRC_DIR, file).split(path.sep);
    const baseName = path.basename(file, '.md');

    // 跳过索引类文件
    if (/^(INDEX|README)$/i.test(baseName)) continue;

    const md = mdCache.get(file);
    const { html, title, headings } = renderMarkdown(stripQuiz(md));
    if (!html.trim()) continue;

    const subjectName = relInSrc.length > 1 ? relInSrc[0] : '其他';
    // 第二层目录 = 子主题（如 总结/Java/集合框架/）。父主题页先列子主题，点进去再看内容，
    // 这样同一门语言的多个话题不会在首页铺成一排。
    const subTheme = relInSrc.length > 2 ? relInSrc[1] : null;
    if (!subjects.has(subjectName)) subjects.set(subjectName, []);

    const isAux = Object.prototype.hasOwnProperty.call(AUX_TITLES, baseName);
    const isOverview = subTheme ? baseName === subTheme : baseName === subjectName;   // 与所在目录同名的总览
    const chapterNo = baseName.match(/^第(\d+)章/);
    const isChapter = Boolean(chapterNo);

    const baseId = relPath.replace(/^总结\//, '').replace(/\.md$/, '');

    // 章节：按小节拆成多页，归到同一个分组里
    if (isChapter) {
      const parts = splitChapterSections(stripQuiz(md));
      if (parts.length >= 3) {
        const chapterOrder = Number(chapterNo[1]) * 100;
        parts.forEach((p, i) => {
          const r = renderMarkdown(p.md);
          if (!r.html.trim()) return;
          const ann = annotateTerms(r.html, glossaryBySubject.get(subjectName) || []);
          subjects.get(subjectName).push({
            id: `${baseId}~s${i}`,
            name: p.name,
            file: baseName,
            kind: 'chapter',
            group: baseId,
            groupName: title || baseName,
            groupOrder: chapterOrder,
            order: chapterOrder + i,
            chars: p.md.length,
            html: ann.html,
            terms: ann.used,
            headings: r.headings,
          });
          totalChars += p.md.length;
        });
        continue;
      }
    }

    const ann =
      baseName === '术语表' ? { html, used: [] } : annotateTerms(html, glossaryBySubject.get(subjectName) || []);

    subjects.get(subjectName).push({
      id: baseId,
      name: AUX_TITLES[baseName] || title || baseName,
      file: baseName,
      kind: isOverview ? 'overview' : isAux ? 'appendix' : isChapter ? 'chapter' : 'note',
      // 子主题目录里的页面归到同一个组：主题页先显示「集合框架 / 控制流」这些子主题，
      // 点进去才看具体页面（app 的 viewSubject/viewChapter 直接消费这两个字段）。
      ...(subTheme ? { group: `${subjectName}/${subTheme}`, groupName: subTheme } : {}),
      // 总览最前 → 第N章按编号 → 其他笔记 → 附录最后
      order: isOverview
        ? -10
        : isAux
          ? 900 + Object.keys(AUX_TITLES).indexOf(baseName)
          : isChapter
            ? Number(chapterNo[1]) * 100
            : 500,
      chars: md.length,
      html: ann.html,
      terms: ann.used,
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

  // 404 兜底页：地址写错/带多余路径时，别让用户看到 GitHub 的 404，直接进 app
  // base 用绝对路径，因为这个页面可能被挂在任意深度上
  const indexHtml = await readFile(path.join(ROOT, 'app', 'index.html'), 'utf8');
  const notFound = indexHtml.replace('<head>', '<head>\n  <base href="/study/">');
  await writeFile(path.join(ROOT, 'app', '404.html'), notFound, 'utf8');
  console.log('✓ 生成 404 兜底页 → app/404.html');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
