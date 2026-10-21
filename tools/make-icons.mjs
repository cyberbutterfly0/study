#!/usr/bin/env node
/**
 * make-icons.mjs —— 生成 PWA 图标
 *
 * 不装任何依赖，手写 PNG 编码（zlib + CRC32 都是 Node 自带的）。
 * 图案：品牌蓝圆角方底 + 一本翻开的白色书，页面上三条文字线。
 *
 * 用法：node tools/make-icons.mjs
 */

import zlib from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'app', 'icons');

const BRAND = [0x41, 0x76, 0xe6];
const WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array(width*height*4) → PNG Buffer */
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = rgba[y * width * 4 + x];
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 图形

/** 圆角矩形内有向距离判定的简化版：返回该点是否在 (x0,y0)-(x1,y1) 半径 r 的圆角矩形内 */
function inRoundRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
  if (cx === px && cy === py) return true;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRect(px, py, x0, y0, x1, y1) {
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}

/**
 * 画一张图。
 * @param {number} size
 * @param {object} opt { padding: 0~1，maskable 需要更大留白；transparent: 是否透明底 }
 */
function drawIcon(size, { padding = 0, transparent = true } = {}) {
  const rgba = new Uint8Array(size * size * 4);
  const S = size;
  const pad = S * padding;
  const bgR = S * 0.22;

  // 书页整体尺寸（在非 padding 区域内居中）
  const cx = S / 2;
  const cy = S / 2;
  const bookW = S * 0.52 * (1 - padding * 0.6);
  const bookH = S * 0.40 * (1 - padding * 0.6);
  const gap = Math.max(1.5, S * 0.016);   // 书脊缝隙
  const leftX0 = cx - bookW / 2;
  const leftX1 = cx - gap / 2;
  const rightX0 = cx + gap / 2;
  const rightX1 = cx + bookW / 2;
  const pageY0 = cy - bookH / 2;
  const pageY1 = cy + bookH / 2;

  const lineH = Math.max(1.2, S * 0.022);
  const inset = bookW * 0.09;

  const put = (i, rgb, a) => {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = a;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const px = x + 0.5;
      const py = y + 0.5;

      // 背景圆角方
      if (!inRoundRect(px, py, pad, pad, S - pad, S - pad, bgR)) {
        continue; // 留透明
      }
      put(i, BRAND, 255);

      // 书页做成梯形：书脊一侧下沉，外侧略高，这样一眼是「翻开的书」而不是两个方块
      const dip = bookH * 0.09;
      const inLeft = px >= leftX0 && px <= leftX1 && py >= pageY0 + ((px - leftX0) / (leftX1 - leftX0)) * dip && py <= pageY1;
      const inRight = px >= rightX0 && px <= rightX1 && py >= pageY0 + ((rightX1 - px) / (rightX1 - rightX0)) * dip && py <= pageY1;

      if (inLeft || inRight) {
        put(i, WHITE, 255);

        // 页面上的文字线（三条，中间那条短一点，像正文）
        const x0 = inLeft ? leftX0 + inset : rightX0 + inset;
        const x1 = inLeft ? leftX1 - inset : rightX1 - inset;
        const baseY = inLeft ? pageY0 + dip * 0.35 : pageY0 + dip * 0.35;
        const rows = [
          [baseY + bookH * 0.24, 1],
          [baseY + bookH * 0.48, 0.72],
          [baseY + bookH * 0.7, 0.88],
        ];
        for (const [ly, wf] of rows) {
          const yy0 = ly - lineH / 2;
          const yy1 = ly + lineH / 2;
          const rx1 = x0 + (x1 - x0) * wf;
          if (py >= yy0 && py <= yy1 && px >= x0 && px <= rx1) put(i, BRAND, 255);
        }
      }
    }
  }
  return rgba;
}

// ---------------------------------------------------------------- 输出

const TARGETS = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0 },
  { file: 'favicon-32.png', size: 32, padding: 0 },
];

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="学习">
  <rect width="512" height="512" rx="113" fill="#4176e6"/>
  <g fill="#ffffff">
    <rect x="123" y="153" width="129" height="205" rx="8"/>
    <rect x="260" y="153" width="129" height="205" rx="8"/>
  </g>
  <g fill="#4176e6">
    <rect x="146" y="190" width="86" height="11" rx="5"/>
    <rect x="146" y="243" width="61" height="11" rx="5"/>
    <rect x="146" y="296" width="74" height="11" rx="5"/>
    <rect x="283" y="190" width="86" height="11" rx="5"/>
    <rect x="283" y="243" width="61" height="11" rx="5"/>
    <rect x="283" y="296" width="74" height="11" rx="5"/>
  </g>
</svg>
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const t of TARGETS) {
    const rgba = drawIcon(t.size, { padding: t.padding });
    const png = encodePNG(t.size, t.size, rgba);
    await writeFile(path.join(OUT_DIR, t.file), png);
    console.log(`✓ ${t.file}  ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} KB`);
  }

  await writeFile(path.join(OUT_DIR, 'icon.svg'), SVG, 'utf8');
  console.log('✓ icon.svg');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
