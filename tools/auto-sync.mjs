#!/usr/bin/env node
/**
 * auto-sync.mjs —— 自动找出手机导出的 study-sync-*.json 并导入
 *
 * 用法：
 *   node tools/auto-sync.mjs          导入所有没处理过的导出文件
 *   node tools/auto-sync.mjs --list   只列出找到哪些，不导入
 *
 * 扫描位置：
 *   1. 仓库根目录（手动另存的）
 *   2. _tmp/（我或你临时放的）
 *   3. ~/.dsh/attachments/v1/files/**（在对话里上传的附件，DSH 存放处）
 *
 * 去重靠文件内容 sha256，同一个文件不论换几次路径、存几个副本都只导入一次。
 * 记账文件：data/synced-files.json（已 gitignore）
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LEDGER = path.join(ROOT, 'data', 'synced-files.json');
const NAME_RE = /^study-sync-.*\.json$/i;
const MAX_DEPTH = 5;

const argv = process.argv.slice(2);
const listOnly = argv.includes('--list');

const SCAN_DIRS = [
  ROOT,
  path.join(ROOT, '_tmp'),
  // 在对话里上传的附件，DSH 存在这里
  process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.dsh', 'attachments', 'v1', 'files')
    : null,
  // 从手机传到电脑后，通常落在这两个地方
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : null,
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null,
].filter(Boolean);

async function walk(dir, depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await walk(full, depth + 1, out);
    } else if (NAME_RE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function loadLedger() {
  try {
    return JSON.parse(await readFile(LEDGER, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const ledger = await loadLedger();

  const candidates = [];
  const seen = new Set();
  for (const dir of SCAN_DIRS) {
    for (const f of await walk(dir)) {
      if (seen.has(f)) continue;
      seen.add(f);
      candidates.push(f);
    }
  }

  if (!candidates.length) {
    console.log('没找到 study-sync-*.json。先在手机「配置 → 同步到电脑」导出，再上传或放进 _tmp/。');
    return;
  }

  const fresh = [];
  const freshHashes = new Set();
  for (const file of candidates) {
    let buf;
    try {
      buf = await readFile(file);
    } catch {
      continue;
    }
    const hash = sha(buf);
    if (ledger[hash] || freshHashes.has(hash)) continue;
    // 只认真的备份文件，别的同名 json 跳过
    try {
      const data = JSON.parse(buf.toString('utf8'));
      if (data.format !== 'study-app-backup') continue;
    } catch {
      continue;
    }
    freshHashes.add(hash);
    fresh.push({ file, hash });
  }

  if (!fresh.length) {
    console.log(`找到 ${candidates.length} 个导出文件，都处理过了。`);
    return;
  }

  console.log(`找到 ${fresh.length} 个新导出文件：\n`);
  for (const x of fresh) console.log(`  ${x.hash}  ${x.file}`);

  if (listOnly) {
    console.log('\n（--list 模式，没有导入）');
    return;
  }

  console.log('');
  for (const x of fresh) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sync-in.mjs'), x.file], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    if (r.status === 0) {
      ledger[x.hash] = { file: x.file, at: new Date().toISOString() };
    } else {
      console.error(`\n导入失败：${x.file}`);
    }
  }

  await mkdir(path.dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log(`\n记账已写入 ${path.relative(ROOT, LEDGER)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
