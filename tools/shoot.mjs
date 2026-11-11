// 站点截图 + 度量工具（无依赖，只用到全局安装的 playwright）
// 用法: node tools/shoot.mjs <outDir> [sizes] [urlPath]
//   node tools/shoot.mjs preview/shots "1440x900,1024x768,820x1180,768x1024,390x844"
//   node tools/shoot.mjs preview/detail "1440x900,390x844" work/my-little-rag.html
// 依赖: chromium（playwright 缓存里的 headless shell），路径见下方 EXE
// 输出: <outDir>/<宽>-fold.png、<宽>-full.png、report.json（含溢出/点击区/报错度量）
import { chromium } from '/home/jianran/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = '/home/jianran/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const SITE = new URL('..', import.meta.url).pathname;   // 项目根目录

const outDir = process.argv[2] || 'shots';
const sizes = (process.argv[3] || '1440x900,1024x768,820x1180,768x1024,390x844').split(',');
const urlPath = process.argv[4] || 'index.html';
fs.mkdirSync(outDir, { recursive: true });

const url = urlPath.startsWith('http') ? urlPath : 'file://' + path.join(SITE, urlPath);

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--font-render-hinting=none'] });
const report = {};

for (const s of sizes) {
  const [w, h] = s.split('x').map(Number);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  // 强制显示入场元素，便于整页截图
  await p.evaluate(() => document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-in')));
  await p.waitForTimeout(500);

  const metrics = await p.evaluate(() => {
    const de = document.documentElement;
    const vw = window.innerWidth;
    const rect = el => el.getBoundingClientRect();
    const overRight = [], overLeft = [], small = [], tiny = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const r = rect(el);
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1.5) overRight.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), right: +r.right.toFixed(1), w: +r.width.toFixed(1) });
      if (r.left < -1.5) overLeft.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), left: +r.left.toFixed(1) });
      const interactive = el.matches('a,button,summary,input,select,textarea,[role=button]');
      if (interactive && r.width > 0 && r.height > 0) {
        const target = r.height < 44 || r.width < 44 ? small : null;
        if (target) small.push({ sel: (el.textContent || '').trim().slice(0, 18), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
        if (r.height < 24) tiny.push({ sel: (el.textContent || '').trim().slice(0, 18), h: +r.height.toFixed(1) });
      }
    }
    // 视口内首屏是否露出下一个 section 的标题
    const secs = [...document.querySelectorAll('main > section, .footer')].map(el => {
      const r = rect(el);
      return { id: el.id || el.className, top: +r.top.toFixed(0), h: +r.height.toFixed(0) };
    });
    // 字体实际加载
    const loaded = [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))];
    return {
      viewport: { vw, vh: window.innerHeight },
      scrollWidth: de.scrollWidth,
      docHeight: de.scrollHeight,
      overflowX: de.scrollWidth - vw,
      overRight: overRight.slice(0, 14),
      overLeft: overLeft.slice(0, 8),
      smallTargets: small.slice(0, 14),
      tinyTargets: tiny.slice(0, 14),
      sections: secs,
      fontsLoaded: loaded,
      blueprintCols: (()=>{const b=document.querySelector('.blueprint');return b?getComputedStyle(b).gridTemplateColumns.split(' ').length:0;})(),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });

  await p.screenshot({ path: path.join(outDir, `${w}-fold.png`) });
  await p.screenshot({ path: path.join(outDir, `${w}-full.png`), fullPage: true });
  report[w] = { ...metrics, errors };
  await ctx.close();
}
await b.close();
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
for (const [w, r] of Object.entries(report)) {
  console.log(`\n== ${w} == scrollW ${r.scrollWidth} overflowX ${r.overflowX} docH ${r.docHeight} blueprintCols ${r.blueprintCols} errors ${r.errors.length}`);
  if (r.overRight.length) console.log('  右侧溢出:', r.overRight.map(o => `${o.sel}@${o.right}`).join(' | '));
  if (r.overLeft.length) console.log('  左侧溢出:', r.overLeft.map(o => `${o.sel}@${o.left}`).join(' | '));
  if (r.smallTargets.length) console.log('  小点击区(<44):', r.smallTargets.map(o => `${o.sel||'∅'} ${o.w}x${o.h}`).join(' | '));
  if (r.errors.length) console.log('  报错:', r.errors.slice(0, 5).join(' | '));
}
