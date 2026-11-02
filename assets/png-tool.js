// 纯 Node 的 PNG 处理：解码 → 背景色重映射 → 边缘连通区抠图 → 编码
// 不依赖任何第三方包，只用内置 zlib。
const fs = require('fs');
const zlib = require('zlib');

/* ---------- PNG 解码 ---------- */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit supported, got ' + bitDepth);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported colorType ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[x] = v & 0xff;
    }

    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (channels === 4) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
      else if (channels === 3) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
      else if (channels === 1) { out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255; }
    }
    prev = cur;
  }
  return { w, h, data: out };
}

/* ---------- PNG 编码 ---------- */
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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 处理 ---------- */
const [, , inPath, outPath, targetHex, tolStr] = process.argv;
const tol = Number(tolStr || 70);

const img = decodePNG(fs.readFileSync(inPath));
const { w, h, data } = img;

// 采样左上角作为背景色
const bg = [data[0], data[1], data[2]];
const tgt = [
  parseInt(targetHex.slice(1, 3), 16),
  parseInt(targetHex.slice(3, 5), 16),
  parseInt(targetHex.slice(5, 7), 16),
];

const dist = (i, r, g, b) => {
  const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

// 1) 连通域：从四边泛洪，标记真正的“外部背景”
const outside = new Uint8Array(w * h);
const stack = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const p = y * w + x;
  if (outside[p]) return;
  if (dist(p * 4, bg[0], bg[1], bg[2]) > 26) return;
  outside[p] = 1;
  stack.push(p);
};
for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
while (stack.length) {
  const p = stack.pop();
  const x = p % w, y = (p - x) / w;
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
}

// 2) 颜色重映射：把背景色族（含画师用背景色画的阴影）整体换成目标色
for (let p = 0; p < w * h; p++) {
  const i = p * 4;
  const d = dist(i, bg[0], bg[1], bg[2]);
  if (d >= tol) continue;
  const t = 1 - d / tol;              // 越接近背景色，替换越彻底
  const wgt = t * t * (3 - 2 * t);    // smoothstep
  data[i]     = Math.round(data[i]     + (tgt[0] - data[i])     * wgt);
  data[i + 1] = Math.round(data[i + 1] + (tgt[1] - data[i + 1]) * wgt);
  data[i + 2] = Math.round(data[i + 2] + (tgt[2] - data[i + 2]) * wgt);
}

// 3) 透明度 + 1px 羽化
const alpha = new Float32Array(w * h);
for (let p = 0; p < w * h; p++) alpha[p] = outside[p] ? 0 : 1;
const blurred = new Float32Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        sum += alpha[yy * w + xx]; n++;
      }
    }
    blurred[y * w + x] = sum / n;
  }
}
for (let p = 0; p < w * h; p++) {
  data[p * 4 + 3] = Math.round(Math.max(0, Math.min(1, blurred[p])) * 255);
}

fs.writeFileSync(outPath, encodePNG(w, h, data));
console.log(`wrote ${outPath} ${w}x${h} bg=#${bg.map(v => v.toString(16).padStart(2, '0')).join('')} → ${targetHex}`);
