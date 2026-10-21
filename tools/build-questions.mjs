#!/usr/bin/env node
/**
 * build-questions.mjs
 *
 * 从「总结/」目录下的 Markdown 里抽取选择题，生成 app/data/questions.json。
 *
 * 认的格式（讲课时的约定，见 .dsh/skills/stm32-tutor/references/chapter-format.md）：
 *
 *   **选择题**
 *
 *   1. 题干一行
 *      - A. 选项
 *      - B. 选项
 *      - 答案: B
 *      - 判定: 逐个选项解释为什么对/错
 *      - 踩坑场景: 真实翻车现场（可选）
 *
 *      **术语**
 *
 *      | 术语 | 含义 | 通俗解释 |
 *      |---|---|---|
 *      | HSE | ... | ... |
 *
 * 设计原则：
 *   - 缺字段、答案不在选项里、选项重复 → 直接报错退出，并指出文件与行号。
 *     绝不静默跳过：讲课写错格式时，题目会悄悄从题库里消失，比报错难排查一百倍。
 *   - 稳定 id：学科/章节/q题号。同一题改了讲解文字，答题记录不丢。
 *   - 同时写入 rev（题干+选项的短哈希），题干真被换了，前端能识别出旧记录已失效。
 *
 * 用法：
 *   node tools/build-questions.mjs
 *   node tools/build-questions.mjs --check   只校验不写文件
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, '总结');
const OUT_FILE = path.join(ROOT, 'app', 'data', 'questions.json');

const SKIP_DIRS = new Set(['_阅读版', '_暂存', '.dsh', '.git', 'node_modules', '图']);

const MARK_QUIZ = /^\*\*选择题\*\*\s*$/;
const MARK_TERMS = /^\*\*术语\*\*\s*$/;
const MARK_END = /^(?:#{1,6}\s|\*\*(?:答题记录|实践任务|本章易错点|本章小结)\*\*)/;
const Q_START = /^(\d+)\.\s+(.+)$/;
const OPTION = /^[-*]\s*([A-Za-z])\s*[.、)]\s*(.+)$/;
const FIELD = /^[-*]\s*(答案|判定|解析|踩坑场景|陷阱|类型|标签|出处|来源)\s*[:：]\s*(.*)$/;
const TABLE_ROW = /^\|(.+)\|$/;

// 行内 markdown 归一化，只用于生成 rev 哈希（渲染在前端做）
function normalizeInline(s) {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortHash(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 10);
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
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

/**
 * 解析单个 Markdown 文件里的全部选择题。
 * 返回 { questions, errors }。
 */
function parseFile(md, relPath) {
  const lines = md.split(/\r?\n/);
  const questions = [];
  const errors = [];

  let inQuiz = false;
  let cur = null;
  let field = null;        // 当前可续行的字段
  let inTerms = false;
  let termHeader = 0;      // 0=还没见过表头 1=见过表头 2=见过分隔行
  let curSection = '';     // 当前所在的 ### 小节标题，用来给题目归属

  const fail = (lineNo, msg) => errors.push(`${relPath}:${lineNo} ${msg}`);

  const flush = () => {
    if (!cur) return;
    questions.push(cur);
    cur = null;
    field = null;
    inTerms = false;
    termHeader = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();

    // 记住当前小节（题目归属用）。放在最前面，这样题块之后的 ### 也能被看到
    const h3m = line.match(/^###\s+(.+?)\s*$/);
    if (h3m) curSection = h3m[1];

    if (MARK_QUIZ.test(line)) {
      flush();
      inQuiz = true;
      continue;
    }
    if (inQuiz && MARK_END.test(line)) {
      flush();
      inQuiz = false;
      continue;
    }
    if (!inQuiz) continue;

    // ---- 题干 ----
    const qm = line.match(Q_START);
    if (qm) {
      flush();
      cur = {
        no: Number(qm[1]),
        stem: qm[2].trim(),
        section: curSection,
        options: [],
        answer: '',
        explain: '',
        pitfall: '',
        kind: '',
        terms: [],
        line: lineNo,
      };
      field = 'stem';
      continue;
    }

    if (!cur) continue;

    // ---- 术语表 ----
    if (MARK_TERMS.test(line)) {
      inTerms = true;
      termHeader = 0;
      field = null;
      continue;
    }
    if (inTerms) {
      const tm = line.match(TABLE_ROW);
      if (tm) {
        const cells = tm[1].split('|').map((c) => c.trim());
        if (termHeader === 0) {
          termHeader = 1;            // 表头：术语 / 含义 / 通俗解释
        } else if (termHeader === 1) {
          termHeader = 2;            // 分隔行 ----
        } else if (cells.length >= 3 && cells[0]) {
          cur.terms.push({ term: cells[0], meaning: cells[1], plain: cells[2] });
        }
        continue;
      } else if (line === '') {
        continue;                    // 表格之间的空行不算结束
      } else {
        inTerms = false;             // 表格结束，落回正文
      }
    }

    // ---- 选项 ----
    const om = line.match(OPTION);
    if (om && !cur.answer) {
      cur.options.push({ key: om[1].toUpperCase(), text: om[2].trim() });
      field = null;
      continue;
    }

    // ---- 字段 ----
    const fm = line.match(FIELD);
    if (fm) {
      const key = fm[1];
      const val = fm[2].trim();
      if (key === '答案') {
        cur.answer = val.toUpperCase().replace(/[^A-Z]/g, '');
        field = null;
      } else if (key === '判定' || key === '解析') {
        cur.explain = val;
        field = 'explain';
      } else if (key === '踩坑场景' || key === '陷阱') {
        cur.pitfall = val;
        field = 'pitfall';
      } else if (key === '类型' || key === '标签') {
        cur.kind = val;
        field = null;
      } else {
        field = null;                // 出处/来源：记下不参与判题，暂时忽略
      }
      continue;
    }

    // ---- 续行 ----
    if (line && field && cur[field] !== undefined) {
      cur[field] = (cur[field] ? cur[field] + ' ' : '') + line;
      continue;
    }
    if (line) field = null;
  }

  flush();

  // ---- 校验 ----
  for (const q of questions) {
    if (q.options.length < 2) {
      fail(q.line, `第 ${q.no} 题只有 ${q.options.length} 个选项（至少 2 个）`);
    }
    if (!q.answer) {
      fail(q.line, `第 ${q.no} 题缺少「- 答案: X」`);
    } else if (!q.options.some((o) => o.key === q.answer)) {
      fail(q.line, `第 ${q.no} 题答案 ${q.answer} 不在选项 [${q.options.map((o) => o.key).join('')}] 里`);
    }
    const keys = q.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      fail(q.line, `第 ${q.no} 题选项字母重复：${keys.join('')}`);
    }
    if (!q.stem) fail(q.line, `第 ${q.no} 题题干为空`);
    if (!q.explain) fail(q.line, `第 ${q.no} 题缺少「- 判定:」，答完无法解释`);
  }

  return { questions, errors };
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  let files;
  try {
    files = await walk(SRC_DIR);
  } catch (e) {
    console.error(`找不到源目录：${SRC_DIR}`);
    process.exit(1);
  }
  files.sort((a, b) => a.localeCompare(b, 'zh'));

  const allErrors = [];
  const subjects = new Map();   // 学科（顶层目录名）→ Map(章节名 → questions)
  let total = 0;

  for (const file of files) {
    const md = await readFile(file, 'utf8');
    if (!md.includes('**选择题**')) continue;

    const { questions, errors } = parseFile(md, rel(file));
    allErrors.push(...errors);
    if (!questions.length) continue;

    const parts = path.relative(SRC_DIR, file).split(path.sep);
    const subjectName = parts.length > 1 ? parts[0] : '其他';
    const chapterName = path.basename(file, '.md');

    if (!subjects.has(subjectName)) subjects.set(subjectName, new Map());
    subjects.get(subjectName).set(chapterName, { questions, file: rel(file) });
    total += questions.length;
  }

  if (allErrors.length) {
    console.error(`\n题库格式有问题，共 ${allErrors.length} 处：\n`);
    for (const e of allErrors) console.error('  ✗ ' + e);
    console.error('\n修正上面的 Markdown 后重跑。没有写出任何文件。\n');
    process.exit(1);
  }

  if (!total) {
    console.error('没有抽到任何题目。检查 md 里是否有「**选择题**」段落。');
    process.exit(1);
  }

  // ---- 组装输出 ----
  const chapterList = [];
  const usedIds = new Set();
  let seq = 0;

  for (const [subjectName, chapters] of subjects) {
    const chapterObjs = [];
    const chapterKeys = [...chapters.keys()].sort((a, b) => a.localeCompare(b, 'zh'));
    for (const chapterName of chapterKeys) {
      const { questions } = chapters.get(chapterName);
      const qs = questions.map((q) => {
        let id = `${subjectName}/${chapterName}/q${q.no}`;
        while (usedIds.has(id)) id += '-' + (++seq);
        usedIds.add(id);
        return {
          id,
          no: q.no,
          section: q.section || '',
          stem: q.stem,
          options: q.options,
          answer: q.answer,
          explain: q.explain,
          pitfall: q.pitfall || '',
          kind: q.kind || '',
          terms: q.terms,
          rev: shortHash(
            [q.stem, q.answer, ...q.options.map((o) => o.key + o.text)].map(normalizeInline).join('\u0001')
          ),
        };
      });
      qs.sort((a, b) => a.no - b.no);
      const sectionNames = [...new Set(qs.map((q) => q.section).filter(Boolean))];
      chapterObjs.push({
        id: `${subjectName}/${chapterName}`,
        name: chapterName,
        source: chapters.get(chapterName).file,
        sections: sectionNames,
        questions: qs,
      });
    }
    chapterList.push({ id: subjectName, name: subjectName, chapters: chapterObjs });
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalQuestions: total,
    subjects: chapterList,
  };

  const summary = chapterList
    .map((s) => `${s.name}：` + s.chapters.map((c) => `${c.name}(${c.questions.length})`).join('，'))
    .join('\n  ');

  if (checkOnly) {
    console.log(`✓ 校验通过，共 ${total} 道题（--check，未写文件）\n  ${summary}`);
    return;
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1);
  console.log(`✓ 抽取 ${total} 道题 → ${rel(OUT_FILE)}（${kb} KB）`);
  console.log(`  ${summary}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
