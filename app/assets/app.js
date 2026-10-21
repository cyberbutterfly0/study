/**
 * app.js —— 界面与路由
 *
 * 三个 tab：学习 / 提问 / 配置。
 * 路由走 hash，所有页面共用一次性渲染 + 事件委托，避免框架依赖。
 */

import { renderMarkdown } from './markdown.js';
import * as store from './store.js';
import { streamChat, testConnection, MODELS } from './ai.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast-host');

// 「学习」tab 记住最后停在哪一页，切到提问/配置再切回来不丢位置
const LAST_STUDY_KEY = 'study-app:last-study';

function readLastStudy() {
  try {
    const v = localStorage.getItem(LAST_STUDY_KEY);
    return v && v.startsWith('#/') ? v : '';
  } catch {
    return '';
  }
}

function saveLastStudy(hash) {
  try {
    localStorage.setItem(LAST_STUDY_KEY, hash);
  } catch {
    /* 隐私模式下写不了，不影响用 */
  }
}

const state = {
  lib: null,
  qs: null,
  progress: {},
  settings: store.getSettings(),
  chat: [],
  quiz: null,          // { hash, qids, idx, picks, correct }
  sending: false,
  abortCtl: null,
  readToc: false,
  dataSource: 'local',   // local = 打包进来的副本；cloud = 启动后从 GitHub 拉到更新的
  lastStudyHash: readLastStudy(),   // 学习区最后停在哪（切 tab 回来用）
};

// ---------------------------------------------------------------- 小工具

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, ms = 2000) {
  if (!$toast) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $toast.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

function nav(hash) {
  if (location.hash === hash) {
    render();
    return;
  }
  location.hash = hash;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { name: 'study' };
  const parts = raw.split('/');
  return { name: parts[0], args: parts.slice(1).map(decodeURIComponent) };
}

function fmtBytes(n) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

/** 字符数 → 「5.2 万」这种好读的写法 */
function fmtChars(n) {
  if (!n) return '0';
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n);
}

// ---------------------------------------------------------------- 数据查找

function allSections() {
  const out = [];
  for (const s of state.lib?.subjects || []) {
    for (const sec of s.sections) out.push({ subject: s, section: sec });
  }
  return out;
}

function findSection(id) {
  return allSections().find((x) => x.section.id === id) || null;
}

function allQuestions() {
  const out = [];
  for (const s of state.qs?.subjects || []) {
    for (const c of s.chapters) {
      for (const q of c.questions) out.push({ subject: s, chapter: c, q });
    }
  }
  return out;
}

function questionById(qid) {
  return allQuestions().find((x) => x.q.id === qid) || null;
}

function chapterQuestions(chapterId) {
  // 学科页把多个章用逗号拼在一起传进来，这里统一按集合过滤
  const ids = String(chapterId).split(',').filter(Boolean);
  return allQuestions().filter((x) => ids.includes(x.chapter.id));
}

/**
 * 某个阅读小节对应的题目。
 * 章节被拆成多节后，section.group 指向原来的章，题目靠 q.section（小节标题）对上。
 * 没拆的普通页面就直接取整章。
 */
function sectionQuestions(section) {
  if (!section) return [];
  const items = chapterQuestions(section.group || section.id);
  if (!section.group) return items;
  return items.filter((x) => x.q.section === section.name);
}

function reviewQuestions() {
  const now = Date.now();
  return allQuestions().filter((x) => {
    const p = state.progress[x.q.id];
    return p && p.status === 'wrong' && (!p.due || p.due <= now);
  });
}

function wrongQuestions(chapterId) {
  return allQuestions().filter((x) => {
    if (chapterId && x.chapter.id !== chapterId) return false;
    const p = state.progress[x.q.id];
    return p && p.status === 'wrong';
  });
}

function subjectStats(subjectId) {
  const qs = allQuestions().filter((x) => x.subject.id === subjectId);
  let mastered = 0;
  let wrong = 0;
  let seen = 0;
  for (const x of qs) {
    const p = state.progress[x.q.id];
    if (!p) continue;
    seen++;
    if (p.status === 'mastered') mastered++;
    if (p.status === 'wrong') wrong++;
  }
  return { total: qs.length, mastered, wrong, seen };
}

// ---------------------------------------------------------------- 图标

const ICON = {
  study: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v13.5"/><path d="M6.5 17H20"/><path d="M4 5.5v12A2.5 2.5 0 0 0 6.5 20H20"/></svg>`,
  ask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.7 8.7 0 0 1-3.9-.9L3 21l1.9-5.4A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.1a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.46 1Z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></svg>`,
};

// ---------------------------------------------------------------- 公共片段

function tabbar(active) {
  const tabs = [
    // 学习 tab 自己算目标地址：在别处就看上次停的页面，已经在学习区就回首页
    { id: 'study', label: '学习', act: 'tab-study', hash: '' },
    { id: 'ask', label: '提问', act: 'nav', hash: '#/ask' },
    { id: 'settings', label: '配置', act: 'nav', hash: '#/settings' },
  ];
  return `<nav class="tabbar">${tabs
    .map(
      (t) =>
        `<button class="tab ${active === t.id ? 'active' : ''}" data-act="${t.act}" data-to="${t.hash}">${ICON[t.id]}<span>${t.label}</span></button>`
    )
    .join('')}</nav>`;
}

function header({ title, sub = '', back = '', right = '' }) {
  return `<header class="page-header">
    ${back ? `<button class="icon-btn" data-act="nav" data-to="${back}" aria-label="返回">${ICON.back}</button>` : ''}
    <h1>${esc(title)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${right}
  </header>`;
}

// ---------------------------------------------------------------- 学习首页

function viewStudy() {
  const subjects = state.lib?.subjects || [];
  const pq = allQuestions();
  const list = Object.values(state.progress);
  const due = store.dueCount(list);
  const wrong = store.wrongCount(list);
  const mastered = store.masteredCount(list);

  // 阅读进度：滚过半篇算「读过」
  const readMarks = state.readMarks || {};
  const isRead = (id) => (readMarks[id] || 0) >= 0.5;
  const totalSecs = subjects.reduce((n, s) => n + s.sections.length, 0);
  const readSecs = subjects.reduce((n, s) => n + s.sections.filter((sec) => isRead(sec.id)).length, 0);

  const cards = subjects
    .map((s) => {
      const st = subjectStats(s.id);
      const readN = s.sections.filter((sec) => isRead(sec.id)).length;
      const desc = [
        `${s.sections.length} 篇笔记`,
        readN ? `已读 ${readN}/${s.sections.length}` : '',
        st.total ? `${st.total} 道题` : '',
        st.mastered ? `已掌握 ${st.mastered}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<button class="list-item" data-act="nav" data-to="#/s/${encodeURIComponent(s.id)}">
        <span class="avatar">${esc(s.name.slice(0, 1))}</span>
        <span class="li-main">
          <span class="li-title">${esc(s.name)}</span>
          <span class="li-desc">${esc(desc)}</span>
        </span>
        <span class="chev">›</span>
      </button>`;
    })
    .join('');

  return `<div class="page">
    ${header({ title: '学习', sub: state.lib ? `${subjects.length} 个主题 · ${pq.length} 道题` : '' })}

    ${
      due > 0
        ? `<button class="list-item" style="border:1px solid var(--amber);background:var(--amber-soft);border-radius:var(--radius-lg);margin-bottom:12px"
            data-act="nav" data-to="#/quiz/review">
            <span class="li-main">
              <span class="li-title" style="color:var(--amber)">今天有 ${due} 道错题要复习</span>
              <span class="li-desc">趁热重做一遍，答对两次才移出错题本</span>
            </span>
            <span class="chev">›</span>
          </button>`
        : ''
    }

    <div class="stats">
      <div class="stat warn"><b>${due}</b><span>待复习</span></div>
      <div class="stat accent"><b>${readSecs}<i style="font-style:normal;font-size:15px;color:var(--text-3);font-weight:400">/${totalSecs}</i></b><span>已读笔记</span></div>
      <div class="stat"><b>${mastered}</b><span>已掌握</span></div>
    </div>

    <h2 class="section-title">主题</h2>
    <div class="card card-list">
      ${
        cards ||
        `<div class="empty"><div class="big">📚</div><p>还没有笔记内容</p><p class="muted">先在 总结/ 目录里写点东西，再跑 node tools/build-library.mjs</p></div>`
      }
    </div>

    ${
      wrong > 0
        ? `<button class="list-item card" style="margin-top:12px" data-act="nav" data-to="#/quiz/wrong">
            <span class="li-main"><span class="li-title">错题本</span><span class="li-desc">${wrong} 道题在等你</span></span>
            <span class="chev">›</span>
          </button>`
        : ''
    }
  </div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 学科详情

function renderSectionItem(sec, readMarks) {
  const qCount = sectionQuestions(sec).length;
  const ratio = readMarks[sec.id] || 0;
  const done = ratio >= 0.5;
  const kindLabel = { chapter: '章节', appendix: '附录', overview: '总览', note: '笔记' }[sec.kind] || '';
  const desc = [kindLabel, `${Math.round(sec.chars / 1000) || 1}k 字`, qCount ? `${qCount} 题` : ''].filter(Boolean).join(' · ');
  const mark = done
    ? ' · <span style="color:var(--green)">已读完</span>'
    : ratio > 0.05
      ? ` · <span style="color:var(--text-3)">读到 ${Math.round(ratio * 100)}%</span>`
      : '';
  return `<button class="list-item" data-act="nav" data-to="#/r/${encodeURIComponent(sec.id)}">
      <span class="li-main">
        <span class="li-title">${esc(sec.name)}</span>
        <span class="li-desc">${esc(desc)}${mark}</span>
      </span>
      <span class="chev">›</span>
    </button>`;
}

/** 一章的完成度统计（按这一章下的题目算） */
function chapterStats(groupId) {
  const qs = chapterQuestions(groupId);
  let mastered = 0;
  let wrong = 0;
  for (const x of qs) {
    const p = state.progress[x.q.id];
    if (!p) continue;
    if (p.status === 'mastered') mastered++;
    if (p.status === 'wrong') wrong++;
  }
  return { total: qs.length, mastered, wrong };
}

function viewSubject(subjectId) {
  const s = (state.lib?.subjects || []).find((x) => x.id === subjectId);
  if (!s) return viewNotFound();

  const st = subjectStats(subjectId);
  const readMarks = state.readMarks || {};
  const readN = s.sections.filter((sec) => (readMarks[sec.id] || 0) >= 0.5).length;

  // 拆成小节的那些，学科页只列到「章」，点进去再看小节
  const order = [];
  const chapterNodes = new Map();
  for (const sec of s.sections) {
    if (!sec.group) {
      order.push({ type: 'sec', sec });
      continue;
    }
    if (!chapterNodes.has(sec.group)) {
      const node = { type: 'chapter', id: sec.group, name: sec.groupName || '', sections: [] };
      chapterNodes.set(sec.group, node);
      order.push(node);
    }
    chapterNodes.get(sec.group).sections.push(sec);
  }

  const items = order
    .map((node) => {
      if (node.type === 'sec') return renderSectionItem(node.sec, readMarks);
      const secs = node.sections;
      const qCount = chapterQuestions(node.id).length;
      const done = secs.filter((x) => (readMarks[x.id] || 0) >= 0.5).length;
      const desc = [
        `${secs.length} 节`,
        qCount ? `${qCount} 题` : '',
        done ? `已读 ${done}/${secs.length}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<button class="list-item" data-act="nav" data-to="#/ch/${encodeURIComponent(node.id)}">
        <span class="li-main">
          <span class="li-title">${esc(node.name)}</span>
          <span class="li-desc">${esc(desc)}</span>
        </span>
        <span class="chev">›</span>
      </button>`;
    })
    .join('');

  const totalQ = st.total;
  const quizBtns = totalQ
    ? `<div class="btn-row">
        <button class="btn btn-primary" data-act="start-quiz" data-chapter="${esc((state.qs.subjects.find((x) => x.id === subjectId)?.chapters || []).map((c) => c.id).join(','))}">
          开始刷题 <span class="badge brand" style="background:rgba(255,255,255,.2);color:#fff">${totalQ}</span>
        </button>
      </div>`
    : '';

  return `<div class="page">
    ${header({ title: s.name, back: '#/study' })}
    <div class="stats" style="margin-bottom:8px">
      <div class="stat"><b>${readN}<i style="font-style:normal;font-size:15px;color:var(--text-3);font-weight:400">/${s.sections.length}</i></b><span>已读</span></div>
      <div class="stat accent"><b>${st.mastered}</b><span>已掌握</span></div>
      <div class="stat warn"><b>${st.wrong}</b><span>错题</span></div>
    </div>
    ${quizBtns}
    <h2 class="section-title">内容</h2>
    <div class="card card-list">${items}</div>
  </div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 章（小节列表）

function viewChapter(groupId) {
  const secs = [];
  let subject = null;
  for (const s of state.lib?.subjects || []) {
    for (const sec of s.sections) {
      if (sec.group === groupId) {
        secs.push(sec);
        subject = s;
      }
    }
  }
  if (!secs.length || !subject) return viewNotFound();

  const readMarks = state.readMarks || {};
  const name = secs[0].groupName || '';
  const readN = secs.filter((sec) => (readMarks[sec.id] || 0) >= 0.5).length;
  const st = chapterStats(groupId);

  const items = secs.map((sec) => renderSectionItem(sec, readMarks)).join('');

  const quizBtn = st.total
    ? `<div class="btn-row">
        <button class="btn btn-primary" data-act="start-quiz" data-chapter="${esc(groupId)}">
          刷这一章 <span class="badge brand" style="background:rgba(255,255,255,.2);color:#fff">${st.total}</span>
        </button>
      </div>`
    : '';

  return `<div class="page">
    ${header({ title: name, back: `#/s/${encodeURIComponent(subject.id)}` })}
    <div class="stats" style="margin-bottom:8px">
      <div class="stat"><b>${readN}<i style="font-style:normal;font-size:15px;color:var(--text-3);font-weight:400">/${secs.length}</i></b><span>已读</span></div>
      <div class="stat accent"><b>${st.mastered}</b><span>已掌握</span></div>
      <div class="stat warn"><b>${st.wrong}</b><span>错题</span></div>
    </div>
    ${quizBtn}
    <h2 class="section-title">小节</h2>
    <div class="card card-list">${items}</div>
  </div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 阅读页

function viewRead(sectionId) {
  const hit = findSection(sectionId);
  if (!hit) return viewNotFound();
  const { section } = hit;

  const toc = (section.headings || [])
    .filter((h) => h.level === 2)
    .slice(0, 12)
    .map((h) => `<a href="javascript:void 0" data-act="jump" data-id="${h.id}">${esc(h.text)}</a>`)
    .join('');

  const qCount = sectionQuestions(section).length;

  return `<div class="page reader" data-section="${esc(section.id)}">
    ${header({
      title: section.name,
      back: section.group ? `#/ch/${encodeURIComponent(section.group)}` : `#/s/${encodeURIComponent(hit.subject.id)}`,
      right: qCount
        ? `<button class="btn btn-sm btn-primary" data-act="start-quiz" data-section="${esc(section.id)}">刷这节 ${qCount}</button>`
        : '',
    })}
    ${toc ? `<div class="toc"><div class="toc-inner">${toc}</div></div>` : ''}
    <article class="prose">${section.html}</article>
  </div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 刷题

function buildQuiz(hash, kind, arg) {
  let items = [];
  let title = '';
  if (kind === 'c') {
    items = chapterQuestions(arg);
    const hit = allQuestions().find((x) => x.chapter.id === arg);
    title = hit ? hit.chapter.name : '刷题';
  } else if (kind === 's') {
    const hit = findSection(arg);
    items = hit ? sectionQuestions(hit.section) : [];
    title = hit ? hit.section.name : '刷题';
  } else if (kind === 'review') {
    items = reviewQuestions();
    title = '今日复习';
  } else if (kind === 'wrong') {
    items = wrongQuestions(null);
    title = '错题本';
  }
  return { hash, kind, arg, qids: items.map((x) => x.q.id), idx: 0, picks: {}, correct: 0, title, finished: false };
}

function viewQuiz() {
  const r = parseHash();
  const kind = r.args[0] || 'c';
  const arg = r.args[1] || '';
  const hash = location.hash;

  if (!state.quiz || state.quiz.hash !== hash) {
    state.quiz = buildQuiz(hash, kind, arg);
  }
  const s = state.quiz;

  if (!s.qids.length) {
    return `<div class="page">${header({ title: s.title, back: '#/study' })}
      <div class="empty"><div class="big">✓</div><p>这里暂时没有题</p><p class="muted">${
        kind === 'review' || kind === 'wrong' ? '错题都清空了，去学新章节吧' : '这一章还没有出题'
      }</p></div></div>${tabbar('study')}`;
  }

  if (s.finished) return viewQuizResult(s);

  const cur = questionById(s.qids[s.idx]);
  if (!cur) {
    s.finished = true;
    return viewQuizResult(s);
  }
  const { q, chapter } = cur;
  const pick = s.picks[q.id];
  const answered = pick !== undefined;
  const p = state.progress[q.id];

  const options = q.options
    .map((o) => {
      let cls = 'opt';
      if (answered) {
        cls += ' locked';
        if (o.key === q.answer) cls += ' correct';
        else if (o.key === pick) cls += ' wrong';
        else cls += ' dim';
      }
      return `<button class="${cls}" ${answered ? 'disabled' : ''} data-act="pick" data-key="${esc(o.key)}">
        <span class="key">${esc(o.key)}</span><span>${esc(o.text)}</span></button>`;
    })
    .join('');

  const verdict = answered
    ? `<div class="verdict ${pick === q.answer ? 'ok' : 'no'}">
        <div class="verdict-head">${pick === q.answer ? '✓ 答对' : `✗ 答错了，正确答案 ${esc(q.answer)}`}</div>
        <div class="verdict-body">
          ${q.explain ? `<div class="lbl">为什么</div><p>${renderMarkdown(q.explain)}</p>` : ''}
          ${q.pitfall ? `<div class="pitfall"><b>踩坑场景</b>${esc(q.pitfall)}</div>` : ''}
          ${
            (q.terms || []).length
              ? `<details class="terms"><summary>相关术语（${q.terms.length}）</summary>${q.terms
                  .map(
                    (t) => `<div class="term-item"><span class="t">${esc(t.term)}</span>
                      <span class="m">— ${esc(t.meaning)}</span>
                      ${t.plain ? `<div class="p">${esc(t.plain)}</div>` : ''}</div>`
                  )
                  .join('')}</details>`
              : ''
          }
        </div>
      </div>`
    : '';

  const last = s.idx === s.qids.length - 1;

  return `<div class="page" style="padding:0">
    ${header({
      title: s.title,
      sub: `${s.idx + 1}/${s.qids.length}`,
      back: kind === 'c' || kind === 's' ? `#/s/${encodeURIComponent(chapter.id.split('/')[0])}` : '#/study',
    })}
    <div class="quiz-shell">
      <div class="quiz-progress">
        <div class="progress-track"><div class="progress-fill" style="width:${((s.idx + (answered ? 1 : 0)) / s.qids.length) * 100}%"></div></div>
        <span class="quiz-count">${s.idx + 1} / ${s.qids.length}</span>
      </div>

      <div class="q-meta">
        <span class="badge">${esc(chapter.name)}</span>
        <span class="badge">第 ${q.no} 题</span>
        ${p && p.status === 'mastered' ? '<span class="badge green">已掌握</span>' : ''}
        ${p && p.status === 'wrong' ? '<span class="badge red">错过 ' + p.wrongCount + ' 次</span>' : ''}
      </div>

      <h2 class="q-stem">${esc(q.stem)}</h2>
      <div class="options">${options}</div>
      ${verdict}
    </div>
    <div class="quiz-footer">
      ${
        answered
          ? `<button class="btn btn-primary btn-block" data-act="next">${last ? '完成' : '下一题'}</button>`
          : `<button class="btn btn-block btn-ghost" data-act="skip">跳过这题</button>`
      }
    </div>
  </div>`;   // 答题时隐藏底部 tabbar：底部空间留给「下一题」，避免两个栏互相挡
}

function viewQuizResult(s) {
  const done = Object.keys(s.picks).length;
  const rate = done ? Math.round((s.correct / done) * 100) : 0;
  return `<div class="page">
    ${header({ title: '本轮结果', back: '#/study' })}
    <div class="card card-pad" style="text-align:center;padding:28px 16px">
      <div style="font-size:44px;font-weight:600;letter-spacing:-0.03em;line-height:1.1">${rate}%</div>
      <p class="muted" style="margin-top:6px">答对 ${s.correct} / ${done} 题</p>
      ${
        s.correct < done
          ? `<p class="muted" style="margin-top:12px">答错的题已经进错题本，明天会提醒你复习</p>`
          : `<p class="muted" style="margin-top:12px">全对，稳。</p>`
      }
    </div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn" data-act="restart">再来一轮</button>
      <button class="btn btn-primary" data-act="nav" data-to="#/study">回学习</button>
    </div>
  </div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 提问

function viewAsk() {
  const hasKey = Boolean(state.settings.apiKey);
  const msgs = state.chat;

  const body = msgs.length
    ? msgs
        .map((m) => {
          if (m.role === 'user') {
            return `<div class="msg user"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
          }
          return `<div class="msg ai"><div class="bubble">${renderMarkdown(m.content)}${m.streaming ? '<span class="typing"></span>' : ''}</div></div>`;
        })
        .join('')
    : `<div class="empty" style="padding-top:32vh">
        <div class="big">💬</div>
        <p style="font-weight:500;color:var(--text-1);font-size:16px">问点什么</p>
        <p>学到卡住的地方，直接问</p>
        <p class="muted" style="margin-top:14px;font-size:12.5px">只给思路和原理解释，不会替你写完整作业</p>
      </div>`;

  const chips = msgs.length
    ? ''
    : `<div class="chat-toolbar">
        ${['HSE 和 HSI 有什么区别', '为什么要用中断而不是轮询', '帮我解释一下 ArrayList 扩容']
          .map((t) => `<button class="chip" data-act="fill" data-text="${esc(t)}">${esc(t)}</button>`)
          .join('')}
      </div>`;

  return `<div class="page" style="padding:0">
    ${header({
      title: '提问',
      sub: state.settings.model === 'deepseek-reasoner' ? 'R1' : '',
      right: msgs.length ? `<button class="icon-btn" data-act="chat-menu" aria-label="更多">${ICON.more}</button>` : '',
    })}
    <div class="chat-page">
      <div class="chat-scroll" id="chat-scroll">${body}</div>
      ${chips}
      ${
        hasKey
          ? `<div class="composer">
              <div class="composer-box">
                <textarea id="chat-input" rows="1" placeholder="问点什么…" enterkeyhint="send"></textarea>
                <button class="send-btn" data-act="send" id="send-btn" aria-label="发送">${ICON.send}</button>
              </div>
            </div>`
          : `<div class="composer">
              <button class="btn btn-primary btn-block" data-act="nav" data-to="#/settings">先去配置 API Key</button>
            </div>`
      }
    </div>
  </div>${tabbar('ask')}`;
}

// ---------------------------------------------------------------- 配置

function viewSettings() {
  const s = state.settings;
  const hasKey = Boolean(s.apiKey);
  // 有 key 时默认锁住，点「修改」才解锁；没 key 时直接可填
  // 没存过 key 就直接给编辑态（没什么可锁的）；有 key 默认锁住，点「修改」才解
  const keyEditing = hasKey ? state.keyEditing === true : true;
  const keyBtns = keyEditing
    ? `${hasKey ? '<button class="btn btn-ghost btn-sm" data-act="key-cancel">取消</button>' : ''}<button class="btn btn-sm" data-act="key-save">确定</button>`
    : '<button class="btn btn-ghost btn-sm" data-act="key-edit">修改</button>';

  return `<div class="page">
    ${header({ title: '配置' })}

    <h2 class="section-title">DeepSeek API</h2>
    <div class="card card-pad">
      <div class="field">
        <label for="cfg-key">API Key</label>
        <div class="key-row">
          <input class="input input-mono${keyEditing ? '' : ' is-locked'}" id="cfg-key" type="password"
            autocomplete="off" spellcheck="false" placeholder="sk-..."
            value="${esc(s.apiKey)}" ${keyEditing ? '' : 'readonly'}>
          ${keyBtns}
        </div>
        <div class="hint">在 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" style="color:var(--brand-text)">platform.deepseek.com</a> 创建。只存在这台手机浏览器里，不会上传。</div>
      </div>

      <div class="field">
        <label for="cfg-model">模型</label>
        <select class="select" id="cfg-model">
          ${MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${m.name} — ${m.desc}</option>`).join('')}
        </select>
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="cfg-base">Base URL</label>
        <input class="input input-mono" id="cfg-base" type="url" spellcheck="false" value="${esc(s.baseUrl)}">
        <div class="hint">默认 <code>https://api.deepseek.com</code>，用官方就別改。</div>
      </div>

      <button class="btn btn-block" data-act="test-api" ${hasKey ? '' : 'disabled'}>测试连接</button>
    </div>

    <h2 class="section-title">数据</h2>
    <div class="card card-list">
      <button class="list-item" data-act="refresh-cloud">
        <span class="li-main">
          <span class="li-title">检查内容更新</span>
          <span class="li-desc">联网拉一次题库和笔记，有新版就换掉</span>
        </span>
        <span class="chev">›</span>
      </button>
      <button class="list-item" data-act="sync">
        <span class="li-main">
          <span class="li-title">同步到电脑</span>
          <span class="li-desc">把答题记录导出成 JSON，在电脑上跑一条命令合并</span>
        </span>
        <span class="chev">›</span>
      </button>
      <button class="list-item" data-act="export">
        <span class="li-main"><span class="li-title">导出备份</span><span class="li-desc">存一份 JSON，换手机时用</span></span>
        <span class="chev">›</span>
      </button>
      <button class="list-item" data-act="import">
        <span class="li-main"><span class="li-title">导入备份</span><span class="li-desc">合并另一个设备的记录，取更晚的那份</span></span>
        <span class="chev">›</span>
      </button>
      <button class="list-item" data-act="reset">
        <span class="li-main"><span class="li-title" style="color:var(--red)">清空所有记录</span><span class="li-desc">答题记录和对话都删掉，不可恢复</span></span>
        <span class="chev">›</span>
      </button>
    </div>

    <h2 class="section-title">关于</h2>
    <div class="card card-pad">
      <p class="muted" style="margin:0 0 6px">学习助手 · 本地版</p>
      <p class="muted" style="margin:0">内容来自本机 总结/ 目录，题库 ${state.qs?.totalQuestions || 0} 道，笔记 ${fmtChars(state.lib?.totalChars)} 字。所有数据只存在这台手机上。</p>
      <p class="muted" style="margin:10px 0 0">内容版本 ${esc(buildInfo())} · 来源 ${state.dataSource === 'cloud' ? 'GitHub 云端' : '本地打包'}</p>
      <p class="muted" style="margin:6px 0 0">版本 ${esc(APP_VERSION)}</p>
    </div>
  </div>${tabbar('settings')}`;
}

function buildInfo() {
  const d = state.lib?.generatedAt ? new Date(state.lib.generatedAt) : null;
  return d ? `题库 ${d.toLocaleDateString('zh-CN')}` : '未构建';
}

function viewNotFound() {
  return `<div class="page">${header({ title: '找不到页面', back: '#/study' })}
    <div class="empty"><div class="big">🤔</div><p>内容可能已经改名或删除</p></div></div>${tabbar('study')}`;
}

// ---------------------------------------------------------------- 主渲染

function render() {
  const r = parseHash();
  let html;

  // 学习区的页面记一笔，切 tab 回来能接着看
  if (['study', 's', 'ch', 'r', 'quiz'].includes(r.name)) {
    state.lastStudyHash = location.hash;
    saveLastStudy(location.hash);
  }

  switch (r.name) {
    case 's':
      html = viewSubject(r.args[0] || '');
      break;
    case 'ch':
      html = viewChapter(r.args[0] || '');
      break;
    case 'r':
      html = viewRead(r.args[0] || '');
      break;
    case 'quiz':
      html = viewQuiz();
      break;
    case 'ask':
      html = viewAsk();
      break;
    case 'settings':
      html = viewSettings();
      break;
    case 'study':
    default:
      html = viewStudy();
      break;
  }

  $app.innerHTML = html;
  afterRender(r);
}

function afterRender(r) {
  if (r.name === 'ask') {
    const sc = document.getElementById('chat-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    const input = document.getElementById('chat-input');
    if (input && !state.sending) {
      input.focus({ preventScroll: true });
      autoGrow(input);
    }
    updateSendState();
  }

  if (r.name === 'r') {
    observeRead();
  }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function updateSendState() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  if (!input || !btn) return;
  btn.disabled = state.sending || !input.value.trim();
}

// ---------------------------------------------------------------- 阅读进度

let readObserver = null;

function observeRead() {
  if (readObserver) {
    window.removeEventListener('scroll', readObserver);
    readObserver = null;
  }
  const page = document.querySelector('.page.reader');
  if (!page) return;
  const sectionId = page.dataset.section;
  let t = null;
  const onScroll = () => {
    if (t) return;
    t = setTimeout(async () => {
      t = null;
      const el = document.querySelector('.prose');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight + 120;
      const passed = Math.max(0, -rect.top + 100);
      const ratio = total > 0 ? Math.min(1, passed / total) : 1;
      if (ratio > 0.15) {
        state.readMarks = await store.markRead(sectionId, ratio);
      }
    }, 400);
  };
  readObserver = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  // 进来先算一次：一屏就能读完的短笔记不滚动也能被记上
  onScroll();
}

// ---------------------------------------------------------------- 答题动作

async function pickOption(key) {
  const s = state.quiz;
  if (!s) return;
  const qid = s.qids[s.idx];
  if (s.picks[qid] !== undefined) return;

  const hit = questionById(qid);
  if (!hit) return;
  const correct = key === hit.q.answer;

  s.picks[qid] = key;
  if (correct) s.correct++;
  else {
    s.wrongPicks = s.wrongPicks || [];
    s.wrongPicks.push(qid);
  }

  const p = await store.recordAnswer({
    qid,
    chapterId: hit.chapter.id,
    subjectId: hit.subject.id,
    choice: key,
    correct,
    answer: hit.q.answer,
  });
  state.progress[qid] = p;
  render();
}

function nextQuestion() {
  const s = state.quiz;
  if (!s) return;
  if (s.idx >= s.qids.length - 1) {
    s.finished = true;
    render();
  } else {
    s.idx++;
    render();
  }
}

// ---------------------------------------------------------------- 聊天

let currentAiEl = null;

async function sendMessage(text) {
  const content = (text || '').trim();
  if (!content || state.sending) return;

  state.sending = true;
  const now = Date.now();
  state.chat.push({ role: 'user', content, at: now });
  state.chat.push({ role: 'assistant', content: '', streaming: true, at: now });
  await store.saveChat(state.chat.filter((m) => !m.streaming));
  render();

  const aiMsg = state.chat[state.chat.length - 1];
  const ctl = new AbortController();
  state.abortCtl = ctl;

  // 只把历史消息发过去：刚 push 的那条空 assistant 是等待填充的占位，不能带上
  const apiMessages = state.chat
    .slice(0, -1)
    .filter((m) => m.content && String(m.content).trim())
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const full = await streamChat({
      messages: apiMessages,
      settings: state.settings,
      signal: ctl.signal,
      onDelta: (d) => {
        aiMsg.content += d;
        patchAiBubble(aiMsg.content, true);
      },
      onReasoning: () => {
        if (!aiMsg.content) patchAiBubble('思考中…', true);
      },
    });
    aiMsg.content = full || aiMsg.content;
    delete aiMsg.streaming;
  } catch (e) {
    if (e.name === 'AbortError') {
      aiMsg.content = aiMsg.content || '（已停止）';
    } else {
      aiMsg.content = aiMsg.content
        ? aiMsg.content + `\n\n> ⚠️ ${e.message}`
        : `⚠️ ${e.message}`;
      aiMsg.error = true;
    }
    delete aiMsg.streaming;
  } finally {
    state.sending = false;
    state.abortCtl = null;
    await store.saveChat(state.chat.map((m) => ({ role: m.role, content: m.content, at: m.at })));
    render();
  }
}

function patchAiBubble(text, streaming) {
  const sc = document.getElementById('chat-scroll');
  if (!sc) return;
  const nodes = sc.querySelectorAll('.msg.ai .bubble');
  const el = nodes[nodes.length - 1];
  if (!el) return;
  el.innerHTML = renderMarkdown(text) + (streaming ? '<span class="typing"></span>' : '');
  sc.scrollTop = sc.scrollHeight;
}

async function clearChat() {
  state.chat = [];
  await store.clearChat();
  render();
  toast('对话已清空');
}

// ---------------------------------------------------------------- 导出 / 导入 / 同步

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function tsName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function exportBackup(share = false) {
  const data = await store.exportAll();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = `study-sync-${tsName()}.json`;

  if (share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: '学习记录',
          text: '答题记录，电脑上运行 node tools/sync-in.mjs 合并',
        });
        toast('已分享');
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        // 分享失败就退回下载
      }
    }
  }

  downloadBlob(blob, filename);
  toast('已导出 ' + filename, 3000);
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const r = await store.importAll(data);
      state.progress = Object.fromEntries((await store.allProgress()).map((p) => [p.qid, p]));
      render();
      toast(`导入完成：更新 ${r.imported} 条，跳过 ${r.skipped} 条`);
    } catch (e) {
      toast('导入失败：' + e.message, 3000);
    }
  };
  input.click();
}

async function syncToDesktop() {
  await exportBackup(true);
}

async function resetAll() {
  showSheet({
    title: '清空所有记录？',
    desc: '答题记录、错题本、AI 对话全部删除，没法撤销。建议先导出一份备份。',
    confirmText: '确认清空',
    danger: true,
    onConfirm: async () => {
      await store.resetAll();
      state.progress = {};
      state.chat = [];
      render();
      toast('已清空');
    },
  });
}

// ---------------------------------------------------------------- 弹出面板

function showSheet({ title, desc, confirmText, cancelText = '取消', danger = false, onConfirm }) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `<div class="sheet">
    <h3>${esc(title)}</h3>
    ${desc ? `<p>${esc(desc)}</p>` : ''}
    <div class="btn-row">
      <button class="btn" data-x="cancel">${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${esc(confirmText)}</button>
    </div>
  </div>`;
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    const t = e.target;
    if (t === mask || t.dataset?.x === 'cancel') return close();
    if (t.dataset?.x === 'ok') {
      close();
      onConfirm?.();
    }
  });
  document.body.appendChild(mask);
}

// ---------------------------------------------------------------- 事件委托

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'nav':
      nav(el.dataset.to);
      break;

    case 'tab-study': {
      // 已经在学习区 → 回首页；从提问/配置切过来 → 回到上次看的那一页
      const cur = parseHash();
      const inStudy = ['study', 's', 'r', 'quiz'].includes(cur.name);
      nav(inStudy ? '#/study' : state.lastStudyHash || '#/study');
      break;
    }

    case 'jump': {
      const target = document.getElementById(el.dataset.id);
      if (target) {
        const y = target.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      break;
    }

    case 'start-quiz':
      if (el.dataset.section) nav(`#/quiz/s/${encodeURIComponent(el.dataset.section)}`);
      else nav(`#/quiz/c/${encodeURIComponent(el.dataset.chapter)}`);
      break;

    case 'pick':
      await pickOption(el.dataset.key);
      break;

    case 'next':
      nextQuestion();
      break;

    case 'skip':
      nextQuestion();
      break;

    case 'restart':
      state.quiz = null;
      render();
      break;

    case 'fill': {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = el.dataset.text;
        autoGrow(input);
        updateSendState();
        input.focus();
      }
      break;
    }

    case 'send': {
      const input = document.getElementById('chat-input');
      const text = input?.value || '';
      if (input) input.value = '';
      await sendMessage(text);
      break;
    }

    case 'chat-menu':
      showSheet({
        title: '对话',
        desc: `当前 ${state.chat.length} 条消息，保存在本机`,
        confirmText: '清空对话',
        danger: true,
        onConfirm: clearChat,
      });
      break;

    case 'test-api':
      await doTestApi();
      break;

    case 'key-edit': {
      state.keyEditing = true;
      render();
      const el = document.getElementById('cfg-key');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      break;
    }

    case 'key-cancel':
      state.keyEditing = false;
      render();
      break;

    case 'key-save': {
      const el = document.getElementById('cfg-key');
      const v = (el?.value || '').trim();
      if (!v) {
        // 空值 = 想删掉 key，二次确认再清
        showSheet({
          title: '清空 API Key？',
          desc: '清空后「提问」页用不了，要重新填一个才行。',
          confirmText: '清空',
          danger: true,
          onConfirm: () => {
            state.settings = store.saveSettings({ apiKey: '' });
            state.keyEditing = false;
            render();
            toast('已清空');
          },
        });
        return;
      }
      if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(v)) {
        // 不拦死，只提醒——以后 key 格式若变了也别让用户存不进去
        toast('格式看着不像 sk- 开头的 key，已照存');
      }
      state.settings = store.saveSettings({ apiKey: v });
      state.keyEditing = false;
      render();
      toast('已保存');
      break;
    }

    case 'export':
      await exportBackup(false);
      break;

    case 'import':
      importBackup();
      break;

    case 'sync':
      await syncToDesktop();
      break;

    case 'refresh-cloud':
      toast('正在检查…', 1200);
      await refreshFromCloud(true);
      break;

    case 'reset':
      await resetAll();
      break;

    default:
      break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'chat-input') {
    autoGrow(t);
    updateSendState();
  }
  if (t.id === 'cfg-key') {
    // 边打边解锁，否则输入后直接点「测试连接」时按钮还是灰的
    const btn = document.querySelector('[data-act="test-api"]');
    if (btn) btn.disabled = !t.value.trim();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = e.target.value;
    e.target.value = '';
    sendMessage(text);
  }
  if (e.target.id === 'cfg-key' && e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('[data-act="key-save"]')?.click();
  }
});

// 配置项即时保存（API Key 例外：要点「确定」才落盘，避免误删）
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'cfg-model') state.settings = store.saveSettings({ model: t.value });
  if (t.id === 'cfg-base') state.settings = store.saveSettings({ baseUrl: t.value.trim() || 'https://api.deepseek.com' });
});

async function doTestApi() {
  // 用输入框里当前的 key（可能还没点「确定」，测试不该逼人先保存）
  const el = document.getElementById('cfg-key');
  const typed = el?.value.trim();
  const probe = typed ? { ...state.settings, apiKey: typed } : state.settings;
  toast('正在测试…', 1200);
  try {
    const r = await testConnection(probe);
    showSheet({
      title: '连接正常',
      desc: `模型回了「${r.reply || '（空）'}」，耗时 ${r.ms} ms。可以开始提问了。`,
      confirmText: '知道了',
      cancelText: '关闭',
      onConfirm: () => {},
    });
  } catch (e) {
    showSheet({
      title: '连不上',
      desc: e.message,
      confirmText: '去改配置',
      cancelText: '关闭',
      onConfirm: () => document.getElementById('cfg-key')?.focus(),
    });
  }
}

// ---------------------------------------------------------------- 启动

const APP_VERSION = '0.1.0';

/**
 * 内容真源 = GitHub 仓库。
 * 启动时先用打包进来的本地副本秒开，随后在后台拉云端版本；
 * 云端 generatedAt 更新就替换掉，用户不用重装 app 也能拿到新题新笔记。
 * 断网、被墙、仓库改名 —— 都只是拉不到，本地照常能用。
 */
/**
 * 内容真源的候选地址，按顺序试：
 *   1. GitHub Pages 的 data 目录 —— 和 app 同域，装 app 时已经能连通，最稳
 *   2. raw.githubusercontent.com —— 绕过 Pages 的 CDN 缓存，国内可能被墙
 */
const REMOTE_SOURCES = [
  'https://cyberbutterfly0.github.io/study/data',
  'https://raw.githubusercontent.com/cyberbutterfly0/study/main/app/data',
];

/** 依次问每个源要同一个文件，谁先给就用谁 */
async function fetchData(name) {
  for (const base of REMOTE_SOURCES) {
    const j = await fetchJSON(`${base}/${name}`);
    if (j) return j;
  }
  return null;
}

async function fetchJSON(url, timeoutMs = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isNewer(remote, local) {
  if (!remote) return false;
  if (!local) return true;
  const a = remote.generatedAt || '';
  const b = local.generatedAt || '';
  return a > b;
}

async function refreshFromCloud(manual = false) {
  if (!navigator.onLine) {
    if (manual) toast('现在没联网');
    return false;
  }
  const [lib, qs] = await Promise.all([fetchData('library.json'), fetchData('questions.json')]);

  if (!lib && !qs) {
    if (manual) toast('连不上云端，仍用本地版本');
    return false;
  }

  let changed = false;
  if (isNewer(lib, state.lib)) {
    state.lib = lib;
    changed = true;
  }
  if (isNewer(qs, state.qs)) {
    state.qs = qs;
    changed = true;
  }

  if (changed) {
    state.dataSource = 'cloud';
    render();
    toast('内容已更新', 1800);
  } else if (manual) {
    toast('已经是最新的');
  }
  return true;
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

async function boot() {
  try {
    const [lib, qs] = await Promise.all([fetchJSON('./data/library.json'), fetchJSON('./data/questions.json')]);
    if (!lib || !qs) throw new Error('本地数据文件读取失败');
    state.lib = lib;
    state.qs = qs;
  } catch (e) {
    $app.innerHTML = `<div class="page"><div class="empty" style="padding-top:30vh">
      <div class="big">⚠️</div><p>数据加载失败</p><p class="muted">${esc(e.message)}</p>
      <button class="btn mt-16" onclick="location.reload()">重试</button></div></div>`;
    return;
  }

  state.progress = Object.fromEntries((await store.allProgress()).map((p) => [p.qid, p]));
  state.readMarks = await store.getReadMarks();
  state.chat = await store.getChat();
  if (!Array.isArray(state.chat)) state.chat = [];

  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 后台检查云端有没有更新，不阻塞首屏
  refreshFromCloud();
}

boot();
