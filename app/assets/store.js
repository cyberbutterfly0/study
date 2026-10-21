/**
 * store.js —— 本地数据层
 *
 * 全部数据只存在手机浏览器本地（不上传任何服务器）：
 *   localStorage  → 设置项（API key、模型、同步口令）
 *   IndexedDB     → 答题记录、答题日志、AI 对话、阅读进度
 *
 * 导出格式见 exportAll()，电脑端 tools/sync-in.mjs 认这个结构。
 */

const DB_NAME = 'study-app';
const DB_VERSION = 1;
const STORE_PROGRESS = 'progress';   // keyPath: qid
const STORE_LOG = 'log';             // keyPath: id（自增）
const STORE_KV = 'kv';               // keyPath: k

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const s = db.createObjectStore(STORE_PROGRESS, { keyPath: 'qid' });
        s.createIndex('byChapter', 'chapterId');
        s.createIndex('byStatus', 'status');
        s.createIndex('byDue', 'due');
      }
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        const s = db.createObjectStore(STORE_LOG, { keyPath: 'id', autoIncrement: true });
        s.createIndex('byQid', 'qid');
        s.createIndex('byTime', 'at');
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function request(req) {
  return { __req: req };
}

function getAll(storeName) {
  return tx(storeName, 'readonly', (s) => request(s.getAll()));
}

function getOne(storeName, key) {
  return tx(storeName, 'readonly', (s) => request(s.get(key)));
}

function putOne(storeName, value) {
  return tx(storeName, 'readwrite', (s) => s.put(value));
}

function delOne(storeName, key) {
  return tx(storeName, 'readwrite', (s) => s.delete(key));
}

function clearStore(storeName) {
  return tx(storeName, 'readwrite', (s) => s.clear());
}

// ---------------------------------------------------------------- 设置

const SETTINGS_KEY = 'study-app:settings';

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  systemPrompt: '',
  syncToken: '',
  lastSyncAt: 0,
  seenWelcome: false,
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------- 答题记录

/**
 * 答题后更新该题的状态。
 * 规则（刻意做得保守，宁可多复习也不要假掌握）：
 *   - 答对且此前无记录        → learning，答对计数 +1
 *   - 答对且连续答对达 2 次   → mastered，移出错题本
 *   - 答错                    → wrong，连击清零，due = 10 分钟后
 *   - 在错题本里的题答对 1 次 → 仍是 wrong，但 due 推后 1 天（隔天再验一次）
 */
export async function recordAnswer({ qid, chapterId, subjectId, choice, correct, answer }) {
  const prev = (await getOne(STORE_PROGRESS, qid)) || null;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const TEN_MIN = 10 * 60 * 1000;

  const p = prev
    ? { ...prev }
    : { qid, chapterId, subjectId, firstAt: now, attempts: 0, wrongCount: 0, streak: 0, status: 'new', due: 0 };

  p.attempts += 1;
  p.lastAt = now;
  p.lastChoice = choice;

  if (correct) {
    p.streak = (p.streak || 0) + 1;
    if (p.status === 'wrong' || p.status === 'new' || p.status === 'learning') {
      if (p.streak >= 2) {
        p.status = 'mastered';
        p.due = 0;
      } else if (p.status === 'wrong') {
        p.status = 'wrong';        // 还差一次验证，留在错题本
        p.due = now + DAY;
      } else {
        p.status = 'learning';
        p.due = now + DAY * 3;
      }
    }
  } else {
    p.streak = 0;
    p.wrongCount = (p.wrongCount || 0) + 1;
    p.status = 'wrong';
    p.due = now + TEN_MIN;
    p.lastWrongAt = now;
  }

  await putOne(STORE_PROGRESS, p);
  await tx(STORE_LOG, 'readwrite', (s) =>
    s.add({ qid, chapterId, subjectId, choice, correct, answer, at: now })
  );
  return p;
}

export function getProgress(qid) {
  return getOne(STORE_PROGRESS, qid);
}

export function allProgress() {
  return getAll(STORE_PROGRESS);
}

export function clearProgress() {
  return Promise.all([clearStore(STORE_PROGRESS), clearStore(STORE_LOG)]);
}

export function getLog() {
  return getAll(STORE_LOG);
}

// ---------------------------------------------------------------- 对话

const CHAT_KEY = 'current';

export async function getChat() {
  const row = await getOne(STORE_KV, CHAT_KEY);
  return row && Array.isArray(row.messages) ? row.messages : [];
}

export async function saveChat(messages) {
  return putOne(STORE_KV, { k: CHAT_KEY, messages, updatedAt: Date.now() });
}

export async function clearChat() {
  return putOne(STORE_KV, { k: CHAT_KEY, messages: [], updatedAt: Date.now() });
}

// ---------------------------------------------------------------- 阅读进度

const READ_KEY = 'read';

export async function getReadMarks() {
  const row = await getOne(STORE_KV, READ_KEY);
  return row && row.map ? row.map : {};
}

export async function markRead(sectionId, ratio) {
  const map = await getReadMarks();
  const prev = map[sectionId] || 0;
  if (ratio > prev) {
    map[sectionId] = Math.min(1, ratio);
    await putOne(STORE_KV, { k: READ_KEY, map });
  }
  return map;
}

// ---------------------------------------------------------------- 导入导出

export async function exportAll() {
  const [progress, log, messages] = await Promise.all([allProgress(), getLog(), getChat()]);
  const s = getSettings();
  return {
    format: 'study-app-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: navigator.userAgent,
    settings: {
      baseUrl: s.baseUrl,
      model: s.model,
      // API key 不进备份：备份可能经微信/网盘流传，key 不该跟着跑
    },
    progress,
    log,
    chat: messages,
  };
}

/**
 * 合并导入。progress 以「更晚的 lastAt 为准」，log 按 uid 去重。
 * 返回 { imported, skipped }。
 */
export async function importAll(data) {
  if (!data || data.format !== 'study-app-backup') {
    throw new Error('不是本程序的备份文件');
  }

  let imported = 0;
  let skipped = 0;

  for (const p of data.progress || []) {
    if (!p || !p.qid) continue;
    const cur = await getOne(STORE_PROGRESS, p.qid);
    if (cur && (cur.lastAt || 0) >= (p.lastAt || 0)) {
      skipped++;
      continue;
    }
    await putOne(STORE_PROGRESS, p);
    imported++;
  }

  return { imported, skipped };
}

export async function resetAll() {
  await Promise.all([clearStore(STORE_PROGRESS), clearStore(STORE_LOG), clearStore(STORE_KV)]);
}

// ---------------------------------------------------------------- 统计辅助

export function dueCount(progressList, now = Date.now()) {
  return progressList.filter((p) => p.status === 'wrong' && (!p.due || p.due <= now)).length;
}

export function wrongCount(progressList) {
  return progressList.filter((p) => p.status === 'wrong').length;
}

export function masteredCount(progressList) {
  return progressList.filter((p) => p.status === 'mastered').length;
}
