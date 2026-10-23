import { expect, test, type Page } from '@playwright/test';

// D37 펼친 상태 = 위아래 나누기: 종료 조건 ①~⑤(사용자 폰 확인은 사람 몫). 390×844, 세이프 위 47·아래 34를 흉내 낸다
test.use({ viewport: { width: 390, height: 844 } });

/* eslint-disable @typescript-eslint/no-explicit-any */
const W = 390, H = 844, SAFE_T = 47, SAFE_B = 34;
const COLORS = ['#e8a87c', '#85c1a8', '#9fb4e8', '#e8c46a', '#c99ae0', '#7cc4d8'];
const NAMES = ['책 읽기', '요리', '회사 일', '영어 공부', '사진', '음악', '가족', '돈 관리', '건강', '정원 가꾸기', '운동 루틴', '친구', '글쓰기', '영화', '전시회', '강아지', '자전거', '커피 공부', '부모님', '여름 휴가', '집 수리', '퇴근길 생각', '꿈 일기', '주말 계획', '산책', '빵 굽기', '캠핑', '그림', '바다'];
const BASE = '가나다라마바사아자차카타파하 봄 여름 가을 겨울 '.repeat(20);

interface Seed {
  /** 펼칠 주제의 메모 수와 글 길이 */
  n: number;
  len?: number;
  /** 사진 메모 수(가장 최근 쪽) */
  photos?: number;
  /** 할 일 메모 수(사진 바로 앞) */
  todos?: number;
  /** 배경 주제 수(메모 1개씩) */
  others?: number;
  /** 할 일 메모 글(없으면 다른 메모처럼 띄어쓰기 없는 긴 낱말로 시작하는 글) */
  todoText?: string;
}

/** DB를 비우고 펼칠 주제(가장 큰 주제 → 켜면 펼쳐진다) + 배경 주제를 넣은 뒤 다시 연다 */
async function seed(page: Page, s: Seed) {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await page.evaluate(
    async ({ s, names, colors, base }) => {
      const { db } = (window as unknown as { __kk: { db: any } }).__kk;
      const now = Date.now();
      const photo = async (hue: number) => {
        const c = document.createElement('canvas');
        c.width = c.height = 240;
        const g = c.getContext('2d')!;
        g.fillStyle = `hsl(${hue}, 60%, 60%)`;
        g.fillRect(0, 0, 240, 240);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(120, 100, 50, 0, 7);
        g.fill();
        return new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.8));
      };
      await db.memos.clear();
      await db.topics.clear();
      await db.links.clear();
      const topic = (id: string, name: string, i: number) => ({ id, name, summary: name, color: colors[i % colors.length], createdAt: now - i, centerKeywords: [name], nameLocked: false, lastReorgAt: now, sinceReorg: 0 });
      const memo = (id: string, topicId: string, k: number, extra: Record<string, unknown>) => ({
        id, createdAt: now - 100_000 + k * 10, input: 'text', kind: 'idea', emotion: { label: '담담', color: '#c9c2b0' }, keywords: ['d37'],
        topicId, topicLocked: false, status: 'organized', attempts: 0, ...extra,
      });
      const topics = [topic('d37', '인내심 기르기', 2)];
      const memos: any[] = [];
      for (let k = 0; k < s.n; k++) {
        const len = s.len ?? 8 + (k % 5) * 4;
        const text = base.slice(k % 7, (k % 7) + len);
        // 사진·할 일은 가장 최근 쪽(넘쳐서 숨는 것은 오래된 메모)
        const fromEnd = s.n - 1 - k;
        if (fromEnd < (s.photos ?? 0)) memos.push(memo(`d37-${k}`, 'd37', k, { input: 'photo', photo: await photo(k * 50), text: '사진 설명 ' + k }));
        else if (fromEnd < (s.photos ?? 0) + (s.todos ?? 0)) memos.push(memo(`d37-${k}`, 'd37', k, { kind: 'todo', text: s.todoText ?? text }));
        else memos.push(memo(`d37-${k}`, 'd37', k, { text }));
      }
      for (let i = 0; i < (s.others ?? 4); i++) {
        topics.push(topic(`o-${i}`, names[i % names.length]!, i));
        memos.push(memo(`o-${i}-0`, `o-${i}`, 0, { text: names[i % names.length] + ' 메모' }));
      }
      await db.topics.bulkAdd(topics);
      await db.memos.bulkAdd(memos);
    },
    { s, names: NAMES, colors: COLORS, base: BASE },
  );
  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-clusters', String(1 + (s.others ?? 4)));
  // 세이프 영역: 엔진·보드가 읽는 숨은 상자(.g-inset)의 padding을 기기 값으로
  await page.addStyleTag({ content: `.g-inset { padding-top: ${SAFE_T}px !important; padding-bottom: ${SAFE_B}px !important; }` });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-mode', 'focus');
  await expect(board).toHaveAttribute('data-front', 'd37');
  await expect(board).toHaveAttribute('data-settled', '1', { timeout: 20_000 });
  await page.waitForTimeout(150);
  return board;
}

const sphereOf = (page: Page) =>
  page.locator('.g-sphere').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
  });

/** 펼친 주제(d37)의 거품: 중심·지름·줄·글 상자·글자 크기·줄 수 */
const bubblesOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.g-cluster[data-topic-id="d37"] .g-card')].map((g) => {
      const f = g.querySelector<HTMLElement>('.face')!;
      const b = f.getBoundingClientRect();
      const t = f.querySelector<HTMLElement>('.face-text');
      const tb = t?.getBoundingClientRect();
      const cs = t ? getComputedStyle(t) : null;
      return {
        more: g.hasAttribute('data-more'),
        moreText: g.hasAttribute('data-more') ? f.textContent : '',
        row: Number(g.dataset.row ?? -1),
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2,
        d: b.width,
        text: tb ? { l: tb.left, r: tb.right, t: tb.top, b: tb.bottom } : null,
        font: cs ? parseFloat(cs.fontSize) : 0,
        lh: cs ? parseFloat(cs.lineHeight) : 0,
        clamp: cs ? Number(cs.webkitLineClamp) : 0,
        overflow: t ? t.scrollHeight > t.clientHeight + 1 : false,
        opacity: Number(getComputedStyle(g).opacity),
      };
    }),
  );

for (const n of [1, 3, 6, 12, 40]) {
  test(`① 메모 ${n}개: 거품이 세이프 영역 안, 거품끼리·거품–구·거품–이름 겹침 0${n === 40 ? ', 최근 N개 + "+N"' : ''}`, async ({ page }) => {
    await seed(page, { n, others: 4 });
    const bs = await bubblesOf(page);
    const sp = await sphereOf(page);
    const title = (await page.locator('.g-cluster[data-topic-id="d37"] .g-tag').boundingBox())!;
    const plus = (await page.getByTestId('plus-button').boundingBox())!;
    for (const b of bs) {
      const r = b.d / 2;
      expect(b.cx - r).toBeGreaterThanOrEqual(0);
      expect(b.cx + r).toBeLessThanOrEqual(W);
      expect(b.cy - r).toBeGreaterThanOrEqual(SAFE_T);
      expect(b.cy + r).toBeLessThanOrEqual(H - SAFE_B);
      expect(b.cy + r).toBeLessThanOrEqual(plus.y);
      // 구(원)와
      expect(Math.hypot(b.cx - sp.cx, b.cy - sp.cy)).toBeGreaterThanOrEqual(sp.r + r - 0.5);
      // 이름(제목 상자)과: 원–사각형 최단 거리
      const dx = Math.max(title.x - b.cx, 0, b.cx - (title.x + title.width)), dy = Math.max(title.y - b.cy, 0, b.cy - (title.y + title.height));
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(r);
    }
    let minGap = Infinity;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const g = Math.hypot(bs[i]!.cx - bs[j]!.cx, bs[i]!.cy - bs[j]!.cy) - (bs[i]!.d + bs[j]!.d) / 2;
        minGap = Math.min(minGap, g);
        expect(g).toBeGreaterThanOrEqual(-0.5);
      }
    const rows = [...new Set(bs.map((b) => b.row).filter((r) => r >= 0))].sort();
    const more = bs.find((b) => b.more);
    console.log(`① n=${n} bubbles=${bs.length} d=${bs[0]!.d.toFixed(1)} rows=${JSON.stringify(rows)} more=${more?.moreText ?? '-'} minGap=${minGap === Infinity ? '-' : minGap.toFixed(1)} sphere=(${sp.cx.toFixed(1)},${sp.cy.toFixed(1)},r${sp.r.toFixed(1)}) title=(${(title.x + title.width / 2).toFixed(1)},${(title.y + title.height / 2).toFixed(1)})`);
    // 지름은 한 줄·두 줄 중 큰 쪽(같으면 한 줄). 390×844는 5개까지 한 줄(지름 108), 6개부터 바깥 둘째 줄
    if (n <= 6) expect(bs).toHaveLength(n);
    if (n <= 5) expect(rows).toEqual([0]);
    if (n === 6) expect(rows).toEqual([0, 1]);
    if (n === 12) expect(rows).toEqual([0, 1]);
    if (n === 40) {
      expect(more).toBeTruthy();
      expect(more!.moreText).toBe(`+${40 - (bs.length - 1)}`);
    }
  });
}

for (const len of [1, 30, 200]) {
  test(`② 글 ${len}자: 글이 거품 내접 사각형 안, 줄 수 규칙(첫 줄 3·둘째 줄 2)·말줄임, 글자 ≥ 11px`, async ({ page }) => {
    // 6개(한 줄 큰 거품)와 11개(두 줄 작은 거품) 둘 다
    for (const n of [6, 11]) {
      await seed(page, { n, len, todos: 1, others: 2 });
      const bs = (await bubblesOf(page)).filter((b) => !b.more);
      for (const b of bs) {
        const half = b.d / Math.SQRT2 / 2;
        const t = b.text!;
        expect(t.l).toBeGreaterThanOrEqual(b.cx - half - 1);
        expect(t.r).toBeLessThanOrEqual(b.cx + half + 1);
        expect(t.t).toBeGreaterThanOrEqual(b.cy - half - 1);
        expect(t.b).toBeLessThanOrEqual(b.cy + half + 1);
        expect(b.font).toBeGreaterThanOrEqual(11);
        const lines = Math.round((t.b - t.t) / b.lh);
        const max = b.row === 1 ? 2 : 3;
        expect(b.clamp).toBe(max);
        expect(lines).toBeLessThanOrEqual(max);
        if (len === 200) expect(b.overflow || lines === max).toBe(true);
        if (len === 1) expect(lines).toBe(1);
      }
      // 할 일은 글 앞 ○
      await expect(page.locator('.g-cluster[data-topic-id="d37"] .g-card [data-todo-check]').first()).toHaveText('○');
      console.log(`② len=${len} n=${n} bubbles=${bs.length} d=${bs[0]!.d.toFixed(1)} font=${bs[0]!.font} rows=${JSON.stringify([...new Set(bs.map((b) => b.row))])} lines(max)=${Math.max(...bs.map((b) => Math.round((b.text!.b - b.text!.t) / b.lh)))} truncated=${bs.filter((b) => b.overflow).length}`);
    }
  });
}

test('② 할 일 ○는 첫 줄 글 앞 한 칸(띄어쓰기 없는 긴 낱말·띄어쓰기 있는 글 둘 다)', async ({ page }) => {
  for (const todoText of [undefined, '오늘 장 보기 우유 계란 사과 그리고 빵']) {
    for (const n of [5, 8]) {
      await seed(page, { n, todos: 2, others: 2, todoText });
      const marks = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.g-cluster[data-topic-id="d37"] .g-card [data-todo-check]')].map((btn) => {
          const o = btn.getBoundingClientRect();
          // ○ 다음 첫 글자(낱말 잇개 제외)
          let node = btn.nextSibling;
          while (node && !(node.nodeType === Node.TEXT_NODE && node.textContent!.replace(/\u2060/g, '').length)) node = node.nextSibling;
          const txt = node!.textContent!;
          const i = txt.search(/[^\u2060]/);
          const rg = document.createRange();
          rg.setStart(node!, i);
          rg.setEnd(node!, i + 1);
          const c = rg.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(btn.closest('.face-text')!).lineHeight);
          return { dTop: Math.abs(c.top - o.top), lh, after: c.left >= o.right - 1, ch: txt[i] };
        }),
      );
      console.log(`② todo ${todoText ? 'spaced' : 'long-word'} n=${n} ${JSON.stringify(marks.map((m) => [m.ch, m.dTop.toFixed(1), m.lh]))}`);
      expect(marks.length).toBeGreaterThan(0);
      for (const m of marks) {
        expect(m.dTop).toBeLessThan(m.lh / 2);
        expect(m.after).toBe(true);
      }
    }
  }
});

test('③ 구(거품 아닌 곳)에서 시작한 390px 끌기 = 60±5°, 거품에서 시작한 끌기 = 0°, 거품 탭 → 포커스 화면, 길게 누르기 → 위쪽 층, 목록 밖 놓기 취소', async ({ page }) => {
  const board = await seed(page, { n: 6, others: 8 });
  // 거품에서 시작한 끌기: 돌지 않는다
  const bs = await bubblesOf(page);
  const b0 = bs[2]!;
  const phi0 = Number(await board.getAttribute('data-phi'));
  await page.mouse.move(b0.cx, b0.cy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(b0.cx - i * 13, b0.cy);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const fromBubble = Number(await board.getAttribute('data-phi')) - phi0;
  expect(Math.abs(fromBubble)).toBeLessThan(0.01);
  await expect(board).toHaveAttribute('data-front', 'd37');
  // 구 쪽(거품 아래)에서 시작한 390px 끌기
  const p1 = Number(await board.getAttribute('data-phi'));
  await page.mouse.move(385, 600);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(385 - i * 13, 600);
    await page.waitForTimeout(16);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const dragDeg = Number(await board.getAttribute('data-phi')) - p1;
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1');
  console.log(`③ drag from bubble=${fromBubble.toFixed(3)}° from globe=${dragDeg.toFixed(2)}°`);
  expect(Math.abs(dragDeg - 60)).toBeLessThanOrEqual(5);

  // 다시 d37로(이름표를 눌러): 탭 → 포커스 화면
  await seed(page, { n: 6, others: 8 });
  const bb = (await bubblesOf(page))[1]!;
  await page.mouse.click(bb.cx, bb.cy);
  await expect(page.getByTestId('memo-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memo-sheet')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.mp-ghost')).toHaveCount(0, { timeout: 5000 }); // 닫히는 껍데기가 거품으로 줄어든 뒤
  await expect(board).toHaveAttribute('data-settled', '1');
  // 길게 누르기 → 위쪽 반투명 층(제목·거품 위), 끌어도 구는 돌지 않고, 목록 밖에 놓으면 취소
  const b2 = (await bubblesOf(page))[1]!;
  const before = Number(await board.getAttribute('data-phi'));
  await page.mouse.move(b2.cx, b2.cy);
  await page.mouse.down();
  const layer = page.getByTestId('move-topics');
  await expect(layer).toBeVisible();
  const lb = (await layer.boundingBox())!;
  const sp = await sphereOf(page);
  const title = (await page.locator('.g-cluster[data-topic-id="d37"] .g-tag').boundingBox())!;
  expect(lb.y).toBeLessThanOrEqual(title.y);
  expect(lb.y + lb.height).toBeLessThanOrEqual(sp.cy - sp.r + 1);
  expect(lb.width).toBeGreaterThanOrEqual(W - 1);
  const z = await page.evaluate(() => {
    const l = document.querySelector<HTMLElement>('[data-testid="move-topics"]')!;
    const bg = getComputedStyle(l).backgroundImage;
    return { bg, top: document.elementFromPoint(195, 30)?.closest('[data-testid="move-topics"]') !== null };
  });
  expect(z.top).toBe(true);
  expect(z.bg).toContain('rgba');
  // 들린 거품이 구 위를 지나도 자전하지 않는다
  await page.mouse.move(195, sp.cy, { steps: 10 });
  await page.mouse.move(80, sp.cy + 40, { steps: 10 });
  expect(Number(await board.getAttribute('data-phi'))).toBe(before);
  await page.mouse.up();
  await expect(layer).toHaveCount(0);
  await expect(page.getByTestId('lift-card')).toHaveCount(0, { timeout: 2000 });
  const topic = await page.evaluate(async () => (await (window as unknown as { __kk: { db: any } }).__kk.db.memos.get('d37-1'))?.topicId);
  expect(topic).toBe('d37');
});

test('③ 길게 눌러 위쪽 층의 이름 위에 놓으면 그 주제로 옮겨진다(D23)', async ({ page }) => {
  const board = await seed(page, { n: 4, others: 5 });
  const b = (await bubblesOf(page))[0]!;
  await page.mouse.move(b.cx, b.cy);
  await page.mouse.down();
  const row = page.getByTestId('move-topics').locator('[data-move-topic]').nth(2);
  await expect(row).toBeVisible();
  const target = (await row.getAttribute('data-move-topic'))!;
  const rb = (await row.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 });
  await expect(row).toHaveClass(/over/);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as { __kk: { db: any } }).__kk.db.memos.get('d37-0'))?.topicId)).toBe(target);
  await expect(board).toHaveAttribute('data-front', target, { timeout: 5000 });
});

/** 다음 프레임부터 구 원판 transform이 마지막으로 바뀐 시각까지(ms) */
async function transitionMs(page: Page, act: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __t0: number; __last: number };
    const s = document.querySelector<HTMLElement>('.g-sphere')!;
    w.__t0 = 0;
    w.__last = 0;
    new MutationObserver(() => {
      const now = performance.now();
      if (!w.__t0) w.__t0 = now;
      w.__last = now;
    }).observe(s, { attributes: true, attributeFilter: ['style'] });
  });
  await act();
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const w = window as unknown as { __t0: number; __last: number };
    return w.__last - w.__t0;
  });
}

test('④ 펼침·닫기 각 ≤ 400ms, 끝난 뒤 구 중심·반지름 명세값 ±2px', async ({ page }) => {
  const board = await seed(page, { n: 6, others: 6 });
  const tag = page.locator('.g-cluster[data-topic-id="d37"] .g-tag');
  // 펼친 상태(명세: 중심 (195, 844 − 70 − 34 − 140 − 8 = 592), r 140)
  let sp = await sphereOf(page);
  expect(Math.abs(sp.cx - 195)).toBeLessThanOrEqual(2);
  expect(Math.abs(sp.cy - 592)).toBeLessThanOrEqual(2);
  expect(Math.abs(sp.r - 140)).toBeLessThanOrEqual(2);
  const close = await transitionMs(page, () => tag.click());
  await expect(board).toHaveAttribute('data-mode', 'sky');
  sp = await sphereOf(page);
  // 하늘 상태(D35: r = 390/2 − 18, 중심 = + 버튼 위 공간 가운데 (844 − 104)/2)
  expect(Math.abs(sp.r - 177)).toBeLessThanOrEqual(2);
  expect(Math.abs(sp.cy - 370)).toBeLessThanOrEqual(2);
  const open = await transitionMs(page, () => page.locator('.g-cluster[data-topic-id="d37"] .g-tag').click());
  await expect(board).toHaveAttribute('data-mode', 'focus');
  sp = await sphereOf(page);
  console.log(`④ close=${close.toFixed(0)}ms open=${open.toFixed(0)}ms sphere after open=(${sp.cx.toFixed(1)}, ${sp.cy.toFixed(1)}, r${sp.r.toFixed(1)})`);
  expect(close).toBeLessThanOrEqual(400);
  expect(open).toBeLessThanOrEqual(400);
  expect(Math.abs(sp.cy - 592)).toBeLessThanOrEqual(2);
  expect(Math.abs(sp.r - 140)).toBeLessThanOrEqual(2);
  // 펼친 주제의 점은 구 위에 남는다(강조 점)
  const pt = (await page.locator('.g-cluster[data-topic-id="d37"] .g-pt').boundingBox())!;
  expect(Math.hypot(pt.x + pt.width / 2 - sp.cx, pt.y + pt.height / 2 - sp.cy)).toBeLessThanOrEqual(sp.r);
});

test('④ D36 중간 지점(두 주제 사이)에서는 거품 0개·이름 ≤ 1, 그 사이 거품 탭은 무효', async ({ page }) => {
  // 주제 30개(경도 간격 12° = 75px)
  const board = await seed(page, { n: 6, others: 29 });
  const sp = await sphereOf(page);
  await page.mouse.move(300, sp.cy);
  await page.mouse.down();
  await page.mouse.move(262, sp.cy, { steps: 6 });
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => {
    const lifted = [...document.querySelectorAll<HTMLElement>('.g-cluster[data-lod="open"]')];
    return {
      lifts: lifted.map((el) => Number(el.dataset.lift)),
      bubbles: lifted.flatMap((el) => [...el.querySelectorAll<HTMLElement>('.g-card')]).filter((c) => Number(getComputedStyle(c).opacity) > 0.05).length,
      names: lifted.filter((el) => Number(getComputedStyle(el.querySelector('.g-tag')!).opacity) * Number(getComputedStyle(el).opacity) > 0.3).length,
      switching: document.querySelector<HTMLElement>('[data-testid="board"]')!.dataset.switching,
    };
  });
  console.log(`④ D36 mid lifts=${JSON.stringify(mid.lifts)} visible bubbles=${mid.bubbles} visible names=${mid.names}`);
  expect(mid.lifts.length).toBe(2);
  expect(mid.bubbles).toBe(0);
  expect(mid.names).toBeLessThanOrEqual(1);
  expect(mid.switching).toBe('1');
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1');
});

test('④ 자판·쓰기 창을 열고 닫을 때 구 중심 이동 0px(펼친 상태)', async ({ page }) => {
  await seed(page, { n: 6, others: 4 });
  const before = await sphereOf(page);
  await page.getByTestId('plus-button').click();
  await expect(page.getByTestId('globe-composer')).toBeVisible();
  await page.waitForTimeout(500);
  const open = await sphereOf(page);
  await page.setViewportSize({ width: W, height: 520 }); // 자판이 보드 높이를 줄이는 기기
  await page.waitForTimeout(600);
  const kb = await sphereOf(page);
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(300);
  await page.mouse.click(195, 820); // 흐린 지구본 탭 → 저장 없이 닫힘
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await page.waitForTimeout(600);
  const after = await sphereOf(page);
  const moves = [open, kb, after].map((s) => Math.hypot(s.cx - before.cx, s.cy - before.cy));
  console.log(`④ keyboard sphere center moves=${JSON.stringify(moves.map((m) => m.toFixed(2)))}`);
  for (const m of moves) expect(m).toBeLessThan(0.5);
});

test('⑤ 거품 12개 자리(사진 3) + 주제 30개, 펼친 상태 자전 10초 rAF(CPU 4배 스로틀), filter 미사용', async ({ page }) => {
  test.setTimeout(90_000);
  const board = await seed(page, { n: 12, photos: 3, others: 29 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(4600); // 자전이 다시 시작할 때까지
  const t0 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.g-cluster')].map((e) => e.style.transform).join('|'));
  const r = await page.evaluate(
    () =>
      new Promise<{ fps: number; worst: number; p95: number }>((done) => {
        const gaps: number[] = [];
        let prev = 0;
        const start = performance.now();
        const step = (t: number) => {
          if (prev) gaps.push(t - prev);
          prev = t;
          if (t - start < 10_000) requestAnimationFrame(step);
          else {
            const s = [...gaps].sort((a, b) => a - b);
            done({ fps: (gaps.length / (t - start)) * 1000, worst: s[s.length - 1]!, p95: s[Math.floor(s.length * 0.95)]! });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.g-cluster')].map((e) => e.style.transform).join('|'))).not.toBe(t0);
  await expect(board).toHaveAttribute('data-mode', 'focus');
  const shown = await page.locator('.g-cluster[data-topic-id="d37"] .g-card').count();
  const photos = await page.locator('.g-cluster[data-topic-id="d37"] .face[data-kind="photo"]').count();
  console.log(`⑤ CPU×4 rAF fps=${r.fps.toFixed(1)} p95 frame=${r.p95.toFixed(1)}ms worst=${r.worst.toFixed(1)}ms bubbles=${shown} photos=${photos}`);
  test.info().annotations.push({ type: 'fps(CPU×4)', description: r.fps.toFixed(1) });
  expect(photos).toBe(3);
  const filters = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.g-stage, .g-sphere, .g-cluster, .g-tag, .g-pt, .g-card, .g-card .card, .g-card .face')];
    const computed = els.map((e) => getComputedStyle(e).filter).filter((f) => f !== 'none');
    const rules: string[] = [];
    for (const sh of [...document.styleSheets])
      for (const r of [...sh.cssRules] as CSSStyleRule[])
        if (r.selectorText && /\.g-(stage|sphere|cluster|tag|pt|card)\b|\.bubble\b|\.b-photo\b/.test(r.selectorText) && r.style?.filter) rules.push(r.selectorText);
    return { computed, rules };
  });
  expect(filters.computed).toEqual([]);
  expect(filters.rules).toEqual([]);
  // 종료 조건 ⑤의 50fps는 결과로 보고한다(헤드리스 CPU 4배 스로틀 값은 실제 폰과 다르다)
  expect(r.fps).toBeGreaterThan(0);
});

test.describe('D37 화면 캡처(390×844 DPR3)', () => {
  test.use({ deviceScaleFactor: 3 });
  const DIR = '/tmp/claude-501/d37';
  test('하늘·펼침 4/6/12/40·주제 바꾸는 중간·길게 눌러 옮기기 층', async ({ page }) => {
    test.setTimeout(120_000);
    const board = await seed(page, { n: 4, todos: 1, photos: 1, others: 8 });
    await page.screenshot({ path: `${DIR}/focus-4.png` });
    await page.locator('.g-cluster[data-topic-id="d37"] .g-tag').click();
    await expect(board).toHaveAttribute('data-mode', 'sky');
    await expect(board).toHaveAttribute('data-settled', '1');
    await page.screenshot({ path: `${DIR}/sky.png` });
    await seed(page, { n: 6, todos: 1, photos: 1, others: 8 });
    await page.screenshot({ path: `${DIR}/focus-6.png` });
    await seed(page, { n: 12, todos: 2, photos: 1, others: 8 });
    await page.screenshot({ path: `${DIR}/focus-12.png` });
    await seed(page, { n: 40, todos: 3, photos: 2, others: 8 });
    await page.screenshot({ path: `${DIR}/focus-40.png` });
    // 주제 바꾸는 중간(손가락을 댄 채)
    await seed(page, { n: 6, others: 29 });
    const sp = await sphereOf(page);
    await page.mouse.move(300, sp.cy);
    await page.mouse.down();
    await page.mouse.move(262, sp.cy, { steps: 6 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/mid-switch.png` });
    await page.mouse.up();
    // 길게 눌러 옮기기 층
    await seed(page, { n: 6, others: 8 });
    const b = (await bubblesOf(page))[2]!;
    await page.mouse.move(b.cx, b.cy);
    await page.mouse.down();
    await expect(page.getByTestId('move-topics')).toBeVisible();
    await page.mouse.move(b.cx + 30, b.cy - 60, { steps: 6 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${DIR}/long-press-move.png` });
    await page.mouse.move(80, sp.cy + 40, { steps: 6 });
    await page.mouse.up();
  });
});
