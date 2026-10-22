/* global console, process, setTimeout, document, window, requestAnimationFrame, innerWidth, innerHeight */
// 지구본 보드 프레임 측정(작업계획서 2026-10-22 §4-5). 판정은 하지 않고 숫자만 찍는다.
// 사용: 개발 서버를 띄운 뒤 `node scripts/perf-globe.mjs [http://localhost:5173]`
// 200장/15주제 데모(?demo=big), 크롬 CPU 4배 감속, CDP 터치로 3초 대각선 끌기, rAF 간격을 3회 잰다.
// 함께 찍는 것: 끄는 중 펼침이 0과 1 사이인 주제 수(2차 2-2), 멈춘 뒤 이름표 중심 오차·화면 밖 카드 수(2-3), 멈추는 시간.
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const RUNS = 3;
const DRAG_MS = 3000;
const SLOW = 32;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function run(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const q = `?demo=big&write=${mode === 'write' ? '1' : '0'}`;
  await page.goto(base + '/' + q);
  await page.waitForSelector('[data-testid=board-info][data-cards="200"]', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=board]')?.dataset.phi, null, { timeout: 10000 });
  await page.waitForTimeout(1200);

  // 정가운데 주제: 이름표 중심 오차, 화면(입력 바 위) 밖 카드 수, 카드 크기
  const frontCheck = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid=board]');
    const c = root.querySelector(`.g-cluster[data-topic-id="${root.dataset.front}"]`);
    const tb = c.querySelector('.g-tag').getBoundingClientRect();
    const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? innerHeight;
    const cards = [...c.querySelectorAll('.g-card .card')].map((e) => e.getBoundingClientRect());
    const out = cards.filter((b) => b.left < -1 || b.right > innerWidth + 1 || b.top < -1 || b.bottom > dockTop + 1).length;
    const m = /scale\(([\d.]+)\)/.exec(c.querySelector('.g-card')?.style.transform ?? '');
    return { off: Math.hypot(tb.x + tb.width / 2 - innerWidth / 2, tb.y + tb.height / 2 - innerHeight / 2), cards: cards.length, out, k: m ? Number(m[1]) : 1 };
  });
  const front = mode === 'board' ? await frontCheck() : null;

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

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const x0 = 190, y0 = 420;
  await touch('touchStart', x0, y0);
  const t0 = Date.now();
  let x = x0, y = y0, partial = 0;
  while (Date.now() - t0 < DRAG_MS) {
    const t = Date.now() - t0;
    x = Math.round(x0 - 130 * Math.sin((2 * Math.PI * t) / 1200));
    y = Math.round(y0 - 90 * Math.sin((2 * Math.PI * t) / 1700));
    await touch('touchMove', x, y);
    if (t > 1000 && !partial)
      partial = await page.evaluate(() => [...document.querySelectorAll('.g-cluster')].filter((e) => Number(e.dataset.e) > 0 && Number(e.dataset.e) < 1).length);
    await new Promise((r) => setTimeout(r, 16));
  }
  await touch('touchEnd', x, y);

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
  const after = settleMs !== null ? await frontCheck() : null;
  await ctx.close();
  const slow = iv.filter((d) => d > SLOW).length;
  return { frames: iv.length, slowPct: (100 * slow) / Math.max(1, iv.length), p95: [...iv].sort((a, b) => a - b)[Math.floor(iv.length * 0.95)] ?? 0, settleMs, front, after, partial };
}

const browser = await chromium.launch();
console.log(`globe perf — ${base}, CPU 4x, diagonal touch drag ${DRAG_MS}ms, ${RUNS} runs`);
for (const mode of ['board', 'write']) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(await run(browser, mode));
  for (const [i, r] of rs.entries())
    console.log(`  ${mode} #${i + 1}: frames ${r.frames}, >${SLOW}ms ${r.slowPct.toFixed(1)}%, p95 ${r.p95.toFixed(1)}ms` +
      (mode === 'board' ? `, half-open topics mid-drag ${r.partial}, settle ${r.settleMs ?? '>4000'}ms` +
        (r.after ? `, label off ${r.after.off.toFixed(1)}px, cards out ${r.after.out}/${r.after.cards}` : '') : ''));
  const f = rs[0].front;
  console.log(`${mode.padEnd(5)} median >${SLOW}ms frames: ${median(rs.map((r) => r.slowPct)).toFixed(1)}%` +
    (mode === 'board' ? ` | settle median ${median(rs.map((r) => r.settleMs ?? Infinity))}ms | first view: label off ${f.off.toFixed(1)}px, cards out ${f.out}/${f.cards}, card scale ${f.k}` : ''));
}
await browser.close();
