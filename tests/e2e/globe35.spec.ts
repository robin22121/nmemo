import { expect, test, type Page } from '@playwright/test';

// D35 화면 안의 작은 지구본: 종료 조건 ①~⑤(⑥ 사용자 폰 확인은 사람 몫). 390×844(아이폰)
test.use({ viewport: { width: 390, height: 844 } });

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES = ['책 읽기', '요리', '회사 일', '영어 공부', '사진', '음악', '가족', '돈 관리', '건강', '정원 가꾸기', '운동 루틴', '친구', '글쓰기', '영화', '전시회', '강아지', '자전거', '커피 공부', '부모님', '여름 휴가', '집 수리', '퇴근길 생각', '꿈 일기', '주말 계획'];

/** 데모(주제 6개)에 주제 24개(메모 3개씩)를 더해 30개로 */
async function seed30(page: Page) {
  await page.evaluate(async (names) => {
    const { db } = (window as unknown as { __kk: { db: any } }).__kk;
    const now = Date.now();
    const colors = ['#e8a87c', '#85c1a8', '#9fb4e8', '#e8c46a', '#c99ae0', '#7cc4d8'];
    const topics = names.map((name, i) => ({ id: `x-${i}`, name, summary: name, color: colors[i % colors.length], createdAt: now - i, centerKeywords: [name], nameLocked: false, lastReorgAt: now, sinceReorg: 0 }));
    const memos = topics.flatMap((t, i) =>
      [0, 1, 2].map((k) => ({
        id: `x-${i}-${k}`, createdAt: now - 1000 * (i * 3 + k), input: 'text', text: `${t.name} 메모 ${k + 1}`, kind: 'idea',
        emotion: { label: '담담', color: '#c9c2b0' }, keywords: [t.name], summary: t.name, topicId: t.id, topicLocked: false, status: 'organized', attempts: 0,
      })),
    );
    await db.topics.bulkAdd(topics);
    await db.memos.bulkAdd(memos);
  }, NAMES);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-clusters', '30');
}

async function boot(page: Page, mode: 'sky' | 'focus', thirty = true) {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  if (thirty) await seed30(page);
  await expect(board).toHaveAttribute('data-settled', '1');
  if ((await board.getAttribute('data-mode')) !== mode) await page.locator(`.g-cluster[data-topic-id="${await board.getAttribute('data-front')}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-mode', mode);
  await expect(board).toHaveAttribute('data-settled', '1', { timeout: 20_000 });
  return board;
}

/** 구 원판(화면 좌표) */
const sphereOf = (page: Page) =>
  page.locator('.g-sphere').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

test('① 390폭: 구 전체가 화면 안(+ 버튼 위), 자전 중 주제는 구 안에서만 움직이고 앞↔뒤는 구의 왼쪽·오른쪽에서만, 앞면은 왼쪽 → 오른쪽', async ({ page }) => {
  await boot(page, 'sky');
  const sp = await sphereOf(page);
  const plus = (await page.getByTestId('plus-button').boundingBox())!;
  expect(sp.left).toBeGreaterThanOrEqual(0);
  expect(sp.right).toBeLessThanOrEqual(390);
  expect(sp.top).toBeGreaterThanOrEqual(0);
  expect(sp.bottom).toBeLessThan(plus.y);
  expect(Math.abs(sp.r - (390 / 2 - 18))).toBeLessThan(1);
  // 4초 쉰 뒤 자전이 시작된다. 그 뒤 6초 동안 프레임마다 모은다
  await page.waitForTimeout(4300);
  const frames = await page.evaluate(
    () =>
      new Promise<{ id: string; lod: string; x: number; y: number }[][]>((done) => {
        const out: { id: string; lod: string; x: number; y: number }[][] = [];
        const t0 = performance.now();
        const step = () => {
          out.push(
            [...document.querySelectorAll<HTMLElement>('.g-cluster[data-topic-id]')].map((el) => {
              const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform)!;
              return { id: el.dataset.topicId!, lod: el.dataset.lod!, x: Number(m[1]), y: Number(m[2]) };
            }),
          );
          if (performance.now() - t0 < 6000) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
  );
  expect(frames.length).toBeGreaterThan(100);
  let rightward = 0, leftward = 0, flips = 0;
  for (let f = 1; f < frames.length; f++)
    frames[f]!.forEach((c, i) => {
      const p = frames[f - 1]![i]!;
      expect(Math.hypot(c.x - sp.cx, c.y - sp.cy)).toBeLessThanOrEqual(sp.r + 1);
      const wasBack = p.lod === 'back', isBack = c.lod === 'back';
      if (wasBack !== isBack) {
        flips++;
        expect(Math.abs(c.x - sp.cx)).toBeGreaterThanOrEqual(0.5 * sp.r);
        if (!isBack) expect(c.x).toBeLessThan(sp.cx); // 왼쪽에서 나타남
        else expect(c.x).toBeGreaterThan(sp.cx); // 오른쪽으로 사라짐
      }
      if (p.lod === 'label' && c.lod === 'label' && c.x !== p.x) {
        if (c.x > p.x) rightward++;
        else leftward++;
      }
    });
  console.log(`① frames=${frames.length} front↔back flips=${flips} label moves right=${rightward} left=${leftward}`);
  expect(rightward).toBeGreaterThan(50);
  expect(leftward).toBe(0);
});

test('② 주제 30개 하늘 상태: 보이는 이름표 박스끼리 겹침 0, 글자 ≥ 11px, 뒷면은 글자 없음(자전 중 여러 번 확인)', async ({ page }) => {
  await boot(page, 'sky');
  await page.waitForTimeout(4300);
  let checked = 0;
  for (let k = 0; k < 8; k++) {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.g-cluster[data-topic-id]')].map((el) => {
        const tag = el.querySelector<HTMLElement>('.g-tag')!;
        const b = tag.getBoundingClientRect();
        const s = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)![1]);
        return { lod: el.dataset.lod!, vis: getComputedStyle(tag).visibility, font: parseFloat(getComputedStyle(tag).fontSize) * s, b: { l: b.left, r: b.right, t: b.top, b: b.bottom } };
      }),
    );
    const shown = r.filter((x) => x.lod === 'label');
    expect(shown.length).toBeGreaterThanOrEqual(5);
    for (const x of shown) {
      expect(x.vis).toBe('visible');
      expect(x.font).toBeGreaterThanOrEqual(11);
    }
    for (const x of r.filter((x) => x.lod === 'back' || x.lod === 'dot')) expect(x.vis).toBe('hidden');
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]!.b, b = shown[j]!.b;
        expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).toBe(false);
      }
    checked += shown.length;
    await page.waitForTimeout(400);
  }
  console.log(`② checked labels=${checked} over 8 samples`);
});

test('③ 390px 끌기 1회 = 60±5°, 손 뗀 뒤 1.5초 안에 멈추고 되돌아가지 않는다', async ({ page }) => {
  const board = await boot(page, 'sky');
  await page.evaluate(() => {
    const w = window as unknown as { tr: [number, number][]; up: number; settledAt: number };
    const b = document.querySelector<HTMLElement>('[data-testid="board"]')!;
    w.tr = [];
    w.settledAt = 0;
    new MutationObserver(() => {
      w.tr.push([performance.now(), Number(b.dataset.phi)]);
      if (w.up && !w.settledAt && b.dataset.settled === '1') w.settledAt = performance.now();
    }).observe(b, { attributes: true, attributeFilter: ['data-phi', 'data-settled'] });
    b.addEventListener('pointerup', () => (w.up = performance.now()), { once: true, capture: true });
  });
  const phi0 = Number(await board.getAttribute('data-phi'));
  // 오른쪽 끝(385)에서 왼쪽 끝 너머(−5)까지 390px, 16ms마다 13px
  await page.mouse.move(385, 400);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(385 - i * 13, 400);
    await page.waitForTimeout(16);
  }
  // 손가락이 움직이는 채로 뗀다(멈춘 손가락 판정 restMs 40ms 전에): 한 프레임만 기다려 그려진 φ를 읽는다
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const dragDeg = Number(await board.getAttribute('data-phi')) - phi0;
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1');
  await page.waitForTimeout(300);
  const { tr, up, settledAt } = await page.evaluate(() => {
    const w = window as unknown as { tr: [number, number][]; up: number; settledAt: number };
    return { tr: w.tr, up: w.up, settledAt: w.settledAt };
  });
  const after = tr.filter((p) => p[0] >= up);
  const total = after[after.length - 1]![1] - phi0;
  let back = 0;
  for (let i = 1; i < after.length; i++) back = Math.min(back, after[i]![1] - after[i - 1]![1]);
  console.log(`③ drag=${dragDeg.toFixed(2)}° total(after glide)=${total.toFixed(2)}° settle=${(settledAt - up).toFixed(0)}ms worstBackStep=${back.toFixed(3)}°`);
  expect(Math.abs(dragDeg - 60)).toBeLessThanOrEqual(5);
  expect(settledAt).toBeGreaterThan(0);
  expect(settledAt - up).toBeLessThanOrEqual(1500);
  expect(back).toBeGreaterThanOrEqual(-0.01);
  expect(Math.abs(Number(await board.getAttribute('data-delta')))).toBeLessThan(0.5);
});

test('④ 펼치기: 이름표가 화면 중앙 ±8px, 카드 고리 전체가 세이프 영역 안, 배경 자전 중 카드 위에 다른 이름표 글자 없음', async ({ page }) => {
  const board = await boot(page, 'focus');
  const front = (await board.getAttribute('data-front'))!;
  const tb = (await page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`).boundingBox())!;
  expect(Math.abs(tb.x + tb.width / 2 - 195)).toBeLessThanOrEqual(8);
  expect(Math.abs(tb.y + tb.height / 2 - 422)).toBeLessThanOrEqual(8);
  const cards = await page.locator(`.g-cluster[data-topic-id="${front}"] .g-card .card`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(cards.length).toBeGreaterThan(3);
  const plus = (await page.getByTestId('plus-button').boundingBox())!;
  for (const c of cards) {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.right).toBeLessThanOrEqual(390);
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.bottom).toBeLessThanOrEqual(plus.y);
  }
  // 뒤 구는 작아지고(반지름 < 하늘 상태) 계속 돈다
  expect((await sphereOf(page)).r).toBeLessThan(390 / 2 - 18 - 10);
  await page.waitForTimeout(4300);
  let seen = 0;
  for (let k = 0; k < 10; k++) {
    const hits = await page.evaluate((f) => {
      const cs = [...document.querySelectorAll(`.g-cluster[data-topic-id="${f}"] .g-card .card`)].map((e) => e.getBoundingClientRect());
      const tags = [...document.querySelectorAll<HTMLElement>(`.g-cluster:not([data-topic-id="${f}"])[data-lod="label"] .g-tag`)].map((e) => e.getBoundingClientRect());
      let n = 0;
      for (const t of tags) for (const c of cs) if (t.left < c.right && c.left < t.right && t.top < c.bottom && c.top < t.bottom) n++;
      return { n, tags: tags.length };
    }, front);
    expect(hits.n).toBe(0);
    seen += hits.tags;
    await page.waitForTimeout(300);
  }
  await expect(board).toHaveAttribute('data-front', front);
  console.log(`④ tag center=(${(tb.x + tb.width / 2).toFixed(1)}, ${(tb.y + tb.height / 2).toFixed(1)}) cards=${cards.length} background labels seen=${seen}`);
});

test('⑤ 30개·집중·자전 10초 rAF 평균 ≥ 50fps, 움직이는 지구본 요소에 filter 없음', async ({ page }) => {
  const board = await boot(page, 'focus');
  await page.waitForTimeout(4300);
  const t0 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.g-cluster')].map((e) => e.style.transform).join('|'));
  const fps = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const start = performance.now();
        const step = (t: number) => {
          n++;
          if (t - start < 10_000) requestAnimationFrame(step);
          else done((n / (t - start)) * 1000);
        };
        requestAnimationFrame(step);
      }),
  );
  // 그동안 배경이 실제로 돌았다
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.g-cluster')].map((e) => e.style.transform).join('|'))).not.toBe(t0);
  await expect(board).toHaveAttribute('data-mode', 'focus');
  console.log(`⑤ rAF average fps=${fps.toFixed(1)}`);
  expect(fps).toBeGreaterThanOrEqual(50);
  const filters = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.g-stage, .g-sphere, .g-cluster, .g-tag, .g-pt, .g-card, .g-card .card, .g-glow')];
    const computed = els.map((e) => getComputedStyle(e).filter).filter((f) => f !== 'none');
    const rules: string[] = [];
    for (const sh of [...document.styleSheets])
      for (const r of [...sh.cssRules] as CSSStyleRule[])
        if (r.selectorText && /\.g-(stage|sphere|cluster|tag|pt|card|glow)\b/.test(r.selectorText) && r.style?.filter) rules.push(r.selectorText);
    return { computed, rules };
  });
  expect(filters.computed).toEqual([]);
  expect(filters.rules).toEqual([]);
});

test('자판·쓰기 창이 열려도 구 중심이 그대로다(점프 없음)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  const before = await sphereOf(page);
  await page.getByTestId('plus-button').click();
  await expect(page.getByTestId('globe-composer')).toBeVisible();
  // 자판이 보드 높이를 줄이는 기기를 흉내 낸다
  await page.setViewportSize({ width: 390, height: 520 });
  await page.waitForTimeout(700);
  const during = await sphereOf(page);
  expect(Math.abs(during.cy - before.cy)).toBeLessThan(1);
  expect(Math.abs(during.cx - before.cx)).toBeLessThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
});
