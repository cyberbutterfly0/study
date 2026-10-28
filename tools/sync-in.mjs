#!/usr/bin/env node
/**
 * sync-in.mjs —— 电脑端：合并手机导出的记录
 *
 * 用法：
 *   node tools/sync-in.mjs <手机导出的 study-sync-*.json>
 *
 * 做四件事：
 *   1. 把答题记录并进  data/sync-state.json（按 lastAt 取更新的那份，重复导入不会算错）
 *   2. 生成 总结/_同步报告.md：各章正确率、错题清单、复习建议
 *   3. 生成 总结/_提问记录.md：手机上问过 DeepSeek 的问题和回答，按天分组，供整理进笔记
 *   4. 打印同样的摘要到终端
 *
 * 默认不改任何笔记文件。想让它顺手把错题追加到 错题本.md，加 --write-wrongbook
 * （只会追加，不会删已有的条目）。
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'sync-state.json');
const CODES_FILE = path.join(ROOT, 'data', 'codes.json');
const REPORT_FILE = path.join(ROOT, '总结', '_同步报告.md');
const CHAT_FILE = path.join(ROOT, '总结', '_提问记录.md');
const QUESTIONS_FILE = path.join(ROOT, 'app', 'data', 'questions.json');
const WRONGBOOK_FILE = path.join(ROOT, '总结', '单片机-智能车', '错题本.md');

const argv = process.argv.slice(2);
const writeWrongbook = argv.includes('--write-wrongbook');
const inputFile = argv.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadJSON(p, fallback = null) {
  if (!(await exists(p))) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pct(a, b) {
  return b ? Math.round((a / b) * 100) + '%' : '—';
}

/** 多行文本转成引用块，用来区分「我问的」和「AI 答的」 */
function quote(text) {
  return String(text || '')
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

/**
 * 把提问记录写成 总结/_提问记录.md。
 * 每次全量重写（state.chat 是累积的），所以重复同步不会产生重复内容。
 */
async function writeChatFile(chat) {
  if (!chat || !chat.length) return;

  const dayOf = (ts) => {
    if (!ts) return '（没记时间）';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const clockOf = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // 配成「问 + 紧随其后的答」
  const pairs = [];
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i];
    if (m.role !== 'user') continue;
    const next = chat[i + 1];
    pairs.push({ q: m, a: next && next.role === 'assistant' ? next : null });
  }

  const out = [];
  out.push('# 提问记录');
  out.push('');
  out.push('> 手机上问 DeepSeek 的记录，由 `tools/sync-in.mjs` 从备份 JSON 累积生成，重复同步不会重复。');
  out.push(`> 最后同步 ${fmtTime(Date.now())} · 共 ${pairs.length} 次问答`);
  out.push('');
  out.push('**怎么用**：把值得留下的内容整理进对应主题的笔记，然后删掉这里对应的小节。');
  out.push('整理时照规矩来：只写骨架，重复讲的合并成一句，别把 AI 的推理过程搬进去。');
  out.push('');

  let lastDay = '';
  for (const { q, a } of pairs) {
    const day = dayOf(q.at);
    if (day !== lastDay) {
      out.push(`## ${day}`);
      out.push('');
      lastDay = day;
    }
    out.push(`### ${clockOf(q.at) || '—'}`);
    out.push('');
    out.push('**问**');
    out.push('');
    out.push(quote(q.content));
    out.push('');
    if (a) {
      out.push('**答**');
      out.push('');
      out.push(String(a.content || '').trim());
      out.push('');
    }
    out.push('---');
    out.push('');
  }

  await mkdir(path.dirname(CHAT_FILE), { recursive: true });
  await writeFile(CHAT_FILE, out.join('\n'), 'utf8');
}

async function main() {
  if (!inputFile) {
    die('用法：node tools/sync-in.mjs <study-sync-YYYYMMDD-HHMM.json>\n（手机上点「配置 → 同步到电脑」拿到那个 JSON）');
  }

  const raw = await readFile(path.resolve(inputFile), 'utf8').catch(() => {
    die(`读不到文件：${inputFile}`);
  });

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    die('不是合法的 JSON');
  }

  if (data.format !== 'study-app-backup') {
    die('这不是本程序导出的备份文件（format 字段不对）');
  }

  // ---------------------------------------------------------------- 合并

  const state = (await loadJSON(STATE_FILE, null)) || {
    version: 1,
    createdAt: new Date().toISOString(),
    lastSyncAt: 0,
    devices: {},
    progress: {},
    log: [],
    codes: {},
  };

  const incomingProgress = data.progress || [];
  const incomingLog = data.log || [];

  let updated = 0;
  let skipped = 0;

  for (const p of incomingProgress) {
    if (!p?.qid) continue;
    const cur = state.progress[p.qid];
    if (!cur || (p.lastAt || 0) > (cur.lastAt || 0)) {
      state.progress[p.qid] = p;
      updated++;
    } else {
      skipped++;
    }
  }

  // 日志去重：qid + 时间戳 视为同一条
  const seen = new Set(state.log.map((l) => `${l.qid}@${l.at}`));
  let newLogs = 0;
  for (const l of incomingLog) {
    const k = `${l.qid}@${l.at}`;
    if (seen.has(k)) continue;
    seen.add(k);
    state.log.push(l);
    newLogs++;
  }
  state.log.sort((a, b) => (a.at || 0) - (b.at || 0));

  // 提问记录：按 role + 时间 + 开头 60 字去重后累积（旧备份没有 at 字段，按 0 排前面）
  state.chat = Array.isArray(state.chat) ? state.chat : [];
  const incomingChat = Array.isArray(data.chat) ? data.chat : [];
  const chatKey = (m) => `${m.role}@${m.at || 0}@${String(m.content || '').slice(0, 60)}`;
  const chatSeen = new Set(state.chat.map(chatKey));
  let newChat = 0;
  for (const m of incomingChat) {
    if (!m || !m.content) continue;
    const k = chatKey(m);
    if (chatSeen.has(k)) continue;
    chatSeen.add(k);
    state.chat.push({ role: m.role, content: m.content, at: m.at || 0 });
    newChat++;
  }
  state.chat.sort((a, b) => (a.at || 0) - (b.at || 0));

  // 编程题草稿：按 updatedAt 取新的；本地没有判定结果时补上
  state.codes = state.codes && typeof state.codes === 'object' ? state.codes : {};
  const incomingCodes = Array.isArray(data.codes) ? data.codes : [];
  let newCodes = 0;
  for (const c of incomingCodes) {
    if (!c?.qid) continue;
    const cur = state.codes[c.qid];
    const newer = !cur || (c.updatedAt || 0) > (cur.updatedAt || 0);
    const fillVerdict = cur && !cur.verdict && c.verdict;
    if (newer || fillVerdict) {
      state.codes[c.qid] = { ...cur, ...c };
      newCodes++;
    }
  }

  const deviceKey = String(data.device || '').slice(0, 60) || 'unknown-device';
  state.devices[deviceKey] = {
    lastSyncAt: Date.now(),
    exportedAt: data.exportedAt,
    records: incomingProgress.length,
  };
  state.lastSyncAt = Date.now();
  state.version = 1;

  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  if (Object.keys(state.codes).length) {
    await writeFile(CODES_FILE, JSON.stringify(state.codes, null, 2), 'utf8');
  }

  // ---------------------------------------------------------------- 报告

  const questions = (await loadJSON(QUESTIONS_FILE, { subjects: [] })) || { subjects: [] };
  const qIndex = new Map();
  for (const s of questions.subjects || []) {
    for (const c of s.chapters || []) {
      for (const q of c.questions || []) {
        qIndex.set(q.id, { subject: s.name, chapter: c.name, q });
      }
    }
  }

  const progressList = Object.values(state.progress);
  const wrong = progressList.filter((p) => p.status === 'wrong');
  const mastered = progressList.filter((p) => p.status === 'mastered');

  // 按章聚合
  const byChapter = new Map();
  for (const p of progressList) {
    const meta = qIndex.get(p.qid);
    const key = meta ? `${meta.subject} / ${meta.chapter}` : p.chapterId || '未知章节';
    if (!byChapter.has(key)) byChapter.set(key, { total: 0, wrong: 0, mastered: 0, attempts: 0 });
    const c = byChapter.get(key);
    c.total++;
    c.attempts += p.attempts || 0;
    if (p.status === 'wrong') c.wrong++;
    if (p.status === 'mastered') c.mastered++;
  }

  const totalAttempts = state.log.length;
  const totalCorrect = state.log.filter((l) => l.correct).length;

  const lines = [];
  lines.push('# 同步报告');
  lines.push('');
  lines.push(`> 由 \`tools/sync-in.mjs\` 自动生成，最后同步 ${fmtTime(state.lastSyncAt)}`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push(`| 做过的题 | ${progressList.length} |`);
  lines.push(`| 已掌握 | ${mastered.length} |`);
  lines.push(`| 在错题本 | ${wrong.length} |`);
  lines.push(`| 累计作答 | ${totalAttempts} 次 |`);
  lines.push(`| 总正确率 | ${pct(totalCorrect, totalAttempts)} |`);
  lines.push(`| 本次新增记录 | ${updated} 条（跳过 ${skipped} 条旧记录） |`);
  lines.push('');

  if (byChapter.size) {
    lines.push('## 各章情况');
    lines.push('');
    lines.push('| 章节 | 已做 | 已掌握 | 错题 | 作答次数 |');
    lines.push('|---|---|---|---|---|');
    for (const [k, v] of byChapter) {
      lines.push(`| ${k} | ${v.total} | ${v.mastered} | ${v.wrong} | ${v.attempts} |`);
    }
    lines.push('');
  }

  // 编程题草稿（手机上写了代码的题，含 AI 判定结果）
  const codeList = Object.values(state.codes);
  if (codeList.length) {
    lines.push('## 编程题草稿');
    lines.push('');
    lines.push('| 题目 | 语言 | 草稿更新 | AI 判定 |');
    lines.push('|---|---|---|---|');
    for (const c of codeList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
      const meta = qIndex.get(c.qid);
      const title = meta ? `${meta.subject} · ${meta.chapter} · 第 ${meta.q.no} 题` : c.qid;
      let verdict = '未判定';
      if (c.verdict) {
        const m = c.verdict.match(/结论[:：]\s*(通过|不通过)/);
        verdict = m ? m[1] : '已判定';
        if (c.verdictAt) verdict += `（${fmtTime(c.verdictAt)}）`;
      }
      lines.push(`| ${title} | ${c.lang || '—'} | ${fmtTime(c.updatedAt)} | ${verdict} |`);
    }
    lines.push('');
  }

  if (wrong.length) {
    lines.push('## 错题清单');
    lines.push('');
    for (const p of wrong.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))) {
      const meta = qIndex.get(p.qid);
      if (!meta) {
        lines.push(`- \`${p.qid}\`（题库里找不到这道题了）`);
        continue;
      }
      const q = meta.q;
      lines.push(`### ${meta.subject} · ${meta.chapter} · 第 ${q.no} 题`);
      lines.push('');
      lines.push(`- 题干：${q.stem}`);
      lines.push(`- 正确答案：${q.answer || '（编程题，无标准答案）'}`);
      lines.push(`- 错了 ${p.wrongCount || 0} 次，最后作答 ${fmtTime(p.lastAt)}`);
      if (q.pitfall) lines.push(`- 踩坑点：${q.pitfall}`);
      lines.push('');
    }
  } else {
    lines.push('## 错题清单');
    lines.push('');
    lines.push('全清空了。');
    lines.push('');
  }

  await mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await writeFile(REPORT_FILE, lines.join('\n'), 'utf8');

  // ---------------------------------------------------------------- 提问记录

  await writeChatFile(state.chat);

  // ---------------------------------------------------------------- 可选：回写错题本

  if (writeWrongbook && wrong.length) {
    let book = (await exists(WRONGBOOK_FILE)) ? await readFile(WRONGBOOK_FILE, 'utf8') : '';
    const today = new Date().toISOString().slice(0, 10);
    const additions = [];

    for (const p of wrong) {
      const meta = qIndex.get(p.qid);
      if (!meta) continue;
      if (book.includes(p.qid)) continue;   // 已经在错题本里就跳过
      const q = meta.q;
      additions.push(
        [
          `### ${today} ｜ ${meta.chapter} ｜ 第 ${q.no} 题`,
          '',
          `- 题目：${q.stem}`,
          `- 选项：${(q.options || []).map((o) => `${o.key}. ${o.text}`).join('；')}`,
          `- 我选：${p.lastChoice || '（未知）'}`,
          `- 正确：${q.answer || '—'}`,
          `- 错因：手机上答错 ${p.wrongCount || 1} 次`,
          `- 正确思路：${(q.explain || '').replace(/\n+/g, ' ').slice(0, 300)}`,
          `- 关联：\`${p.qid}\``,
          '',
        ].join('\n')
      );
    }

    if (additions.length) {
      if (!book.trim()) {
        book = '# 错题本\n\n手机同步过来的错题，按时间倒序追加。\n\n';
      }
      book = book.trimEnd() + '\n\n' + additions.join('\n');
      await writeFile(WRONGBOOK_FILE, book, 'utf8');
      lines.push(`已把 ${additions.length} 道新错题追加到 总结/单片机-智能车/错题本.md`);
    }
  }

  // ---------------------------------------------------------------- 终端输出

  console.log('');
  console.log('  ✓ 同步完成');
  console.log('  ─────────────────────────────');
  console.log(`  记录文件   ${path.relative(ROOT, STATE_FILE).split(path.sep).join('/')}`);
  console.log(`  学情报告   ${path.relative(ROOT, REPORT_FILE).split(path.sep).join('/')}`);
  if (state.chat.length) {
    console.log(`  提问记录   ${path.relative(ROOT, CHAT_FILE).split(path.sep).join('/')}`);
  }
  console.log(`  本次更新   ${updated} 条（跳过 ${skipped} 条旧记录，新增 ${newLogs} 条作答日志）`);
  if (newCodes) console.log(`  编程草稿   ${newCodes} 条更新（累计 ${codeList.length} 条）`);
  if (newChat) console.log(`  新问答     ${newChat} 条（累计 ${state.chat.length} 条消息）`);
  console.log('  ─────────────────────────────');
  console.log(`  做过的题   ${progressList.length}`);
  console.log(`  已掌握     ${mastered.length}`);
  console.log(`  在错题本   ${wrong.length}`);
  console.log(`  总正确率   ${pct(totalCorrect, totalAttempts)}（${totalCorrect}/${totalAttempts}）`);
  console.log('');

  if (wrong.length) {
    console.log('  还没弄懂的题：');
    for (const p of wrong.slice(0, 10)) {
      const meta = qIndex.get(p.qid);
      const stem = meta ? meta.q.stem : p.qid;
      console.log(`    · ${stem.slice(0, 46)}${stem.length > 46 ? '…' : ''}`);
    }
    if (wrong.length > 10) console.log(`    …还有 ${wrong.length - 10} 道，见报告`);
    console.log('');
  }

  if (!writeWrongbook) {
    console.log('  提示：加 --write-wrongbook 可以把错题追加进 错题本.md');
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
