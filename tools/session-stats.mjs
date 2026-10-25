#!/usr/bin/env node
// session-stats.mjs —— 统计本机 DSH 某个工作区下的所有会话（对话）情况
//
// 会话文件 ~/.dsh/sessions/<工作区编码>/<会话id>/session.v4.jsonl.zstd
// 是「多个 zstd 帧拼接」的 jsonl，Node 内置 zstd 一次只解第一帧，所以这里按魔数切帧分别解。
//
// 用法：
//   node tools/session-stats.mjs                 # 默认工作区 E:\dsh结算\study
//   node tools/session-stats.mjs --json          # 输出 JSON
//   node tools/session-stats.mjs --ws 关键字      # 目录名包含该关键字的会话
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function decompressSessionFile(file) {
  const buf = fs.readFileSync(file);
  const cuts = [];
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) cuts.push(i);
  }
  const outs = [];
  for (let k = 0; k < cuts.length; k++) {
    const start = cuts[k];
    const end = cuts[k + 1] ?? buf.length;
    try {
      outs.push(zlib.zstdDecompressSync(buf.subarray(start, end)));
    } catch {
      try { outs.push(zlib.zstdDecompressSync(buf.subarray(start))); } catch { /* 跳过坏帧 */ }
    }
  }
  return Buffer.concat(outs).toString('utf8');
}

function readEvents(file) {
  const text = decompressSessionFile(file);
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
  }
  return events;
}

function userText(event) {
  const content = event.data?.content ?? [];
  const parts = [];
  for (const c of content) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image') parts.push('[截图]');
  }
  return parts.join(' ').trim();
}

function isInjected(text) {
  return text.startsWith('<system-reminder>') || text.startsWith('Current runtime context') || text.startsWith('Time sampled while preparing turn');
}

function summarizeSession(sessionDir) {
  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.jsonl.zstd'));
  if (!files.length) return null;
  const events = readEvents(path.join(sessionDir, files[0]));

  const meta = events.find((e) => e.type === 'session');
  const titles = events.filter((e) => e.type === 'session/title').map((e) => e.data?.title).filter(Boolean);
  const title = titles.at(-1) ?? null;

  const userMsgs = [];
  let assistantMsgs = 0;
  let turns = 0;
  let images = 0;
  for (const e of events) {
    if (e.type === 'user/message') {
      const t = userText(e);
      if (t && !isInjected(t)) {
        userMsgs.push({ time: e.time, text: t });
        images += (e.data?.content ?? []).filter((c) => c.type === 'image').length;
      }
    } else if (e.type === 'assistant/message') {
      assistantMsgs++;
    } else if (e.type === 'turn/end') {
      turns++;
    }
  }

  const times = events.map((e) => e.time).filter((t) => typeof t === 'number');
  return {
    id: meta?.id ?? path.basename(sessionDir),
    createdAt: meta?.createdAt ?? null,
    firstActive: times.length ? Math.min(...times) : null,
    lastActive: times.length ? Math.max(...times) : null,
    title,
    userMessages: userMsgs.length,
    assistantMessages: assistantMsgs,
    turns,
    images,
    firstUserText: userMsgs[0]?.text ?? '',
    lastUserText: userMsgs.at(-1)?.text ?? '',
    lastUserTime: userMsgs.at(-1)?.time ?? null,
  };
}

function fmt(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clip(s, n) {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const wsIdx = args.indexOf('--ws');
const wsKeyword = wsIdx >= 0 ? args[wsIdx + 1] : 'study';

const sessionsRoot = path.join(process.env.USERPROFILE, '.dsh', 'sessions');
const wsDir = fs.readdirSync(sessionsRoot).find((d) => d.includes(wsKeyword));
if (!wsDir) {
  console.error(`找不到工作区目录（关键字: ${wsKeyword}）: ${sessionsRoot}`);
  process.exit(1);
}

const wsPath = path.join(sessionsRoot, wsDir);
const sessions = fs.readdirSync(wsPath)
  .filter((d) => fs.statSync(path.join(wsPath, d)).isDirectory())
  .map((d) => summarizeSession(path.join(wsPath, d)))
  .filter(Boolean)
  .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));

const nonEmpty = sessions.filter((s) => s.userMessages > 0);
const empty = sessions.filter((s) => s.userMessages === 0);

if (jsonOut) {
  console.log(JSON.stringify({ workspace: wsDir, total: sessions.length, nonEmpty: nonEmpty.length, empty: empty.length, sessions }, null, 2));
} else {
  console.log(`工作区: ${wsDir}`);
  console.log(`会话总数: ${sessions.length}（有内容的 ${nonEmpty.length}，空会话 ${empty.length}）\n`);
  console.log('| 标题 | 用户问 | 轮次 | 截图 | 首次活动 | 最后活动 | 首条问题 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const s of nonEmpty) {
    console.log(`| ${clip(s.title ?? '(无标题)', 18)} | ${s.userMessages} | ${s.turns} | ${s.images} | ${fmt(s.firstActive)} | ${fmt(s.lastActive)} | ${clip(s.firstUserText, 30)} |`);
  }
  if (empty.length) {
    console.log(`\n空会话（只有元数据、没有提问）: ${empty.map((s) => `${s.id.slice(0, 12)}… (${fmt(s.createdAt)})`).join('；')}`);
  }
}
