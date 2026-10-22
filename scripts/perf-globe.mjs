/* global console, process, setTimeout, document, window, getComputedStyle, requestAnimationFrame */
// 지구본 보드 프레임 측정(작업계획서 2026-10-22 §4-5). 판정은 하지 않고 숫자만 찍는다.
// 사용: 개발 서버를 띄운 뒤 `node scripts/perf-globe.mjs [http://localhost:5173] [variant a|b]`
// 200장/15주제 데모(?demo=big), 크롬 CPU 4배 감속, CDP 터치로 3초 좌우 끌기, rAF 간격을 3회 잰다.
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const variant = process.argv[3] ?? 'a';
const RUNS = 3;
const DRAG_MS = 3000;
const SLOW = 32;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function run(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const q = `?demo=big&globe=1&variant=${variant}${mode === 'write' ? '&write=1' : ''}`;
  await page.goto(base + '/' + q);
  await page.waitForSelector('[data-testid=board-info][data-cards="200"]', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=board]')?.dataset.phi, null, { timeout: 10000 });
  await page.waitForTimeout(1200);

  // 정면 무리 크기·글자 실효 크기(§4-2)
  const front = await page.evaluate(() => {
    const root = document.querySelector('[data-testid=board]');
    const el = root.querySelector(`.g-cluster[data-topic-id="${root.dataset.front}"]`);
    const m = /scale\(([\d.]+)\)/.exec(el?.style.transform ?? '');
    const scale = m ? Number(m[1]) : NaN;
    const text = el?.querySelector('.face-text') ?? document.querySelector('.g-panel .face-text');
    const font = text ? parseFloat(getComputedStyle(text).fontSize) : NaN;
    return { scale, font, effective: font * (Number.isNaN(scale) ? 1 : scale) };
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const w = window;
    w.__iv = [];
    w.__stop = false;
    let last = 0;
    const f = (t) => {
      if (last) w.__iv.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });

  const y = 470;
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const x0 = 190;
  await touch('touchStart', x0);
  const t0 = Date.now();
  let x = x0;
  while (Date.now() - t0 < DRAG_MS) {
    const t = Date.now() - t0;
    x = Math.round(x0 - 130 * Math.sin((2 * Math.PI * t) / 1200));
    await touch('touchMove', x);
    await new Promise((r) => setTimeout(r, 16));
  }
  await touch('touchEnd', x);

  // 손 뗀 뒤 멈추기까지(§4-1, 감속 상태 그대로)
  let settleMs = null;
  if (mode === 'board') {
    const rel = Date.now();
    while (Date.now() - rel < 4000) {
      const s = await page.evaluate(() => {
        const d = document.querySelector('[data-testid=board]').dataset;
        return { settled: d.settled, delta: Number(d.delta) };
      });
      if (s.settled === '1' && s.delta < 1) { settleMs = Date.now() - rel; break; }
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const iv = await page.evaluate(() => { window.__stop = true; return window.__iv; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ctx.close();
  const slow = iv.filter((d) => d > SLOW).length;
  return { frames: iv.length, slowPct: (100 * slow) / Math.max(1, iv.length), p95: [...iv].sort((a, b) => a - b)[Math.floor(iv.length * 0.95)] ?? 0, settleMs, front };
}

const browser = await chromium.launch();
console.log(`globe perf — ${base}, variant ${variant}, CPU 4x, touch drag ${DRAG_MS}ms, ${RUNS} runs`);
for (const mode of ['board', 'write']) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(await run(browser, mode));
  for (const [i, r] of rs.entries())
    console.log(`  ${mode} #${i + 1}: frames ${r.frames}, >${SLOW}ms ${r.slowPct.toFixed(1)}%, p95 ${r.p95.toFixed(1)}ms` +
      (r.settleMs !== null || mode === 'board' ? `, settle ${r.settleMs ?? '>4000'}ms` : ''));
  const f = rs[0].front;
  console.log(`${mode.padEnd(5)} median >${SLOW}ms frames: ${median(rs.map((r) => r.slowPct)).toFixed(1)}%` +
    (mode === 'board' ? ` | settle median ${median(rs.map((r) => r.settleMs ?? Infinity))}ms | front scale ${f.scale.toFixed(3)}, text ${f.font}px → ${f.effective.toFixed(1)}px` : ''));
}
await browser.close();
