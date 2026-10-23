import { globeViewport, GLOBE, planLabels, projectGlobe, wrapDeg, type GlobeViewport, type RingBox, type ScreenBox } from '../../core/layout/globe';
import { MOTION } from './config';

export interface GlobeCard {
  el: HTMLElement;
  /** 펼친 자리(이름표 중심 기준)와 접힌 점 자리 */
  rx: number;
  ry: number;
  dx: number;
  dy: number;
}

export interface GlobeItem {
  id: string;
  lambda: number;
  beta: number;
  /** 도는 무리 컨테이너(원점 = 이름표 중심) */
  el: HTMLElement;
  tag: HTMLElement | null;
  cards: GlobeCard[];
  /** 펼쳤을 때 카드 크기 */
  k: number;
  /** 처음 정가운데 둘 후보(가장 큰 주제) */
  weight: number;
  /** 펼친 고리가 차지하는 범위(이름표 중심 기준, 엔진이 채운다) */
  ext?: { l: number; r: number; t: number; b: number };
}

export interface EngineOptions {
  /** 짧게 눌렀다 뗌. (x, y)는 화면 좌표 */
  onTap: (target: Element, x: number, y: number) => void;
  shouldIgnore: (target: Element) => boolean;
  /** 회전·전환이 멈췄을 때(정가운데 주제 id) */
  onSettle?: (frontId: string | null) => void;
  /** liftMs 동안 가만히 누름. true를 돌려주면 들어 올림(끌기) 모드: 이후 움직임은 회전 대신 onDrag로 간다 */
  onLift?: (target: Element, x: number, y: number) => boolean;
  onDrag?: (x: number, y: number) => void;
  onDrop?: (x: number, y: number) => void;
  onDragCancel?: () => void;
}

/** open: 떠올라 펼침 · label: 이름표 글자 · dot: 앞면이지만 점만(가장자리·겹침·작은 글자) · back: 뒷면 점 */
type Lod = 'open' | 'label' | 'dot' | 'back';

/** 0·NaN·undefined을 건너뛰고 처음 나오는 양수 */
function firstPositive(...vals: (number | undefined)[]): number {
  for (const v of vals) if (v && v > 0 && Number.isFinite(v)) return v;
  return 0;
}

/**
 * 보드 크기 측정. iOS 홈 화면 앱은 콜드 스타트에서 clientWidth·innerWidth까지 0을 줄 때가 있어 여러 값을 차례로 본다.
 * 모두 0이면 0을 돌려준다(저장하지 말고 다시 잰다).
 */
export function measureBoard(root: HTMLElement): { w: number; h: number } {
  const r = root.getBoundingClientRect?.();
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
  return {
    w: firstPositive(root.clientWidth, r?.width, vv?.width, typeof window === 'undefined' ? 0 : window.innerWidth),
    h: firstPositive(root.clientHeight, r?.height, vv?.height, typeof window === 'undefined' ? 0 : window.innerHeight),
  };
}

/** 이름표를 화면 정가운데 둘 때 카드가 들어갈 화면 안 범위(이름표 중심 기준). 아래는 + 버튼 여백 + safe-area 아래 inset, 위는 safe-area 위 inset */
export function boxOf(w: number, h: number, inset = 0, insetTop = 0): RingBox {
  return { left: -w / 2 + 8, right: w / 2 - 8, top: -h / 2 + MOTION.topPad + insetTop, bottom: h / 2 - MOTION.bottomPad - inset };
}

/**
 * 손 뗄 때 속도(°/s): 마지막 velWindowMs 동안의 (시각, φ) 표본에 맞춘 직선 기울기(최소제곱).
 * 이벤트 하나의 짧은 간격으로 튀지 않는다. 마지막 움직임 뒤 restMs 넘게 가만히 있었으면 멈춘 점을 더해 속도를 깎는다.
 */
export function releaseVelocity(samples: { t: number; phi: number }[], now: number): number {
  const s = samples.filter((p) => now - p.t <= MOTION.velWindowMs);
  const last = s[s.length - 1];
  if (last && now - last.t > MOTION.restMs) s.push({ t: now, phi: last.phi });
  if (s.length < 2) return 0;
  const mt = s.reduce((a, p) => a + p.t, 0) / s.length;
  const mp = s.reduce((a, p) => a + p.phi, 0) / s.length;
  let num = 0, den = 0;
  for (const p of s) {
    num += (p.t - mt) * (p.phi - mp);
    den += (p.t - mt) ** 2;
  }
  return den > 0 ? (num / den) * 1000 : 0;
}

/**
 * 손 뗀 뒤 갈 곳과 감속률. 밀던 방향 앞쪽 주제 중 φ + v·inertiaLead(관성으로 멈출 곳)에 가장 가까운 주제로 간다.
 * 감속률 ω = |v|/거리(범위 안): 속도가 남은 거리에 비례해 줄어 처음 빠르고 정가운데에 가까울수록 느려진다.
 * ω ≥ |v|/거리라서 넘치지 않는다. 이 속도로 넘칠 만큼 가까운 앞 주제는 건너뛴다.
 * 느리게 놓으면(glideMinVel 미만) snapOmega로: 방향이 있으면(snapDirVel 이상) 앞쪽 가장 가까운 주제, 멈춘 손가락이면 가장 가까운 주제.
 * 어느 경우든 밀던 방향과 반대로 돌지 않는다(D35 ③).
 */
export function glideTarget(phi: number, v: number, lambdas: number[]): { target: number; omega: number } {
  const lead = phi + v * MOTION.inertiaLead;
  const sp = Math.abs(v);
  const glide = sp >= MOTION.glideMinVel;
  const dir = sp >= MOTION.snapDirVel ? Math.sign(v) : 0;
  let best = phi;
  let bd = Infinity;
  for (const l of lambdas)
    for (const k of [-360, 0, 360]) {
      const t = phi + wrapDeg(l - phi) + k;
      const ahead = (t - phi) * dir;
      if (dir && ahead < sp / (glide ? MOTION.glideOmegaMax : MOTION.snapOmega)) continue;
      if (Math.abs(t - lead) < bd) {
        bd = Math.abs(t - lead);
        best = t;
      }
    }
  const ahead = (best - phi) * Math.sign(v);
  const omega = glide && ahead > 0 ? Math.min(MOTION.glideOmegaMax, Math.max(MOTION.glideOmegaMin, sp / ahead)) : MOTION.snapOmega;
  return { target: best, omega };
}

/** 임계 감쇠 스프링을 dt만큼 정확히 푼다(x = φ − 목표, dt가 커도 넘치지 않게) */
export function springStep(x: number, v: number, om: number, dt: number): { x: number; v: number } {
  const e = Math.exp(-om * dt);
  const c = v + om * x;
  return { x: (x + c * dt) * e, v: (c - om * (x + c * dt)) * e };
}

/**
 * 정면 주제: 앞면(z > 0) 중 가운데 세로줄(경도 φ)에 가장 가까운 주제, 같으면 더 앞(z 큰) 것. 앞면이 없으면 z가 가장 큰 것.
 * 손을 떼면 주제 경도에 멈추므로(glideTarget) 멈춘 뒤 정면 주제는 늘 가운데 세로줄 위(delta 0)다.
 */
export function frontOf(ps: { delta: number; z: number }[]): number {
  let best = -1;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!, b = best >= 0 ? ps[best]! : null;
    if (!b) { best = i; continue; }
    const pf = p.z > 0, bf = b.z > 0;
    if (pf !== bf ? pf : pf ? Math.abs(p.delta) < Math.abs(b.delta) - 1e-9 || (Math.abs(Math.abs(p.delta) - Math.abs(b.delta)) <= 1e-9 && p.z > b.z) : p.z > b.z) best = i;
  }
  return best;
}

/** 크기 0 측정 뒤 다시 재는 최대 프레임 수 */
const MEASURE_RETRIES = 60;

/** 접힌 점에서 펼친 칸으로 갈 때 카드 크기(펼침 0 근처) */
const DOT_CARD = 0.16;

const smooth01 = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * 화면 안의 작은 지구본 엔진(D35). 구는 세로축으로만 돈다(φ). 끌기는 좌우만, 자전은 앞면 주제가 왼쪽 → 오른쪽으로 흐르게.
 * 프레임마다 무리 컨테이너 N개에 transform·opacity·z-index를 직접 쓰고(React 재렌더 없음), 이름표 글자를 보일지 정한다(planLabels).
 * 집중(펼치기)하면 그 주제만 구에서 떠올라 화면 가운데 고정 레이어로 오고(lift 0→1) 카드가 둘레에 펼쳐진다.
 * 구는 뒤에서 작고 연하게 계속 돈다(D31). 닫으면 구 위 제자리로 돌아간다.
 * 손을 떼면 그 속도를 이어받아 관성으로 멈출 곳에 가장 가까운 주제로 감속하며 멈춘다(임계 감쇠 스프링, D34).
 */
export class GlobeEngine {
  private items: GlobeItem[] = [];
  private phi = NaN;
  private vel = 0;
  private mode: 'idle' | 'drag' | 'spring' | 'wheel' = 'idle';
  private target = 0;
  /** 지금 스프링의 각진동수(1/s). 밀고 난 감속은 손 뗀 속도·거리로 정한다 */
  private omega: number = MOTION.snapOmega;
  private write = false;
  private reduced = false;
  /** 집중 보기(한 주제가 떠올라 펼침) / 하늘 보기(모두 구 위). f는 그 사이 진행값(뒤 구 축소·흐림) */
  private focus = true;
  private focusId: string | null = null;
  private f = 1;
  /** 주제별 떠오름 진행값(0 구 위 · 1 가운데 레이어) */
  private lifts = new Map<string, number>();
  private w = 0;
  private h = 0;
  /** 쓰기 창·자판이 열린 동안 바뀐 크기(닫힌 뒤 적용: 구가 점프하지 않게) */
  private pendingSize = false;
  /** safe-area 아래·위 inset(px) */
  private insetB = 0;
  private insetT = 0;
  private sphere: HTMLElement | null = null;
  private sphereKey = '';
  private raf = 0;
  private measureRaf = 0;
  private last = 0;
  private settled = false;
  private wheelTimer = 0;
  /** 손가락·휠을 마지막으로 댄 시각. 자전은 이후 autorotateResumeMs가 지나야 다시 간다 */
  private idleAt = performance.now();
  private held = false;
  private paused = false;
  private resumeTimer = 0;
  private state = new WeakMap<HTMLElement, { lod?: Lod; p: number }>();
  /** 이름표 크기(배율 1, px) */
  private tagSize = new WeakMap<HTMLElement, { w: number; h: number }>();
  private cardSize = new WeakMap<HTMLElement, { w: number; h: number }>();
  private off: () => void;

  constructor(private root: HTMLElement, private opts: EngineOptions) {
    this.off = this.bind();
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.measureRaf);
    window.clearTimeout(this.wheelTimer);
    window.clearTimeout(this.resumeTimer);
    this.off();
  }

  /** 엔진이 마지막으로 받아들인 보드 크기(0이면 아직 못 잼) */
  get size() {
    return { w: this.w, h: this.h };
  }

  resize(retry = 0) {
    cancelAnimationFrame(this.measureRaf);
    this.measureRaf = 0;
    const { w, h } = measureBoard(this.root);
    if (!w || !h) {
      // 0은 저장하지 않는다(0/0=NaN → transform이 버려져 모든 무리가 왼쪽 위에 쌓인다). resize 이벤트가 안 올 수 있어 직접 다시 잰다
      if (retry < MEASURE_RETRIES) this.measureRaf = requestAnimationFrame(() => this.resize(retry + 1));
      return;
    }
    const g = this.root.querySelector<HTMLElement>('.g-inset');
    const cs = g ? getComputedStyle(g) : null;
    const insetB = parseFloat(cs?.paddingBottom ?? '') || 0;
    const insetT = parseFloat(cs?.paddingTop ?? '') || 0;
    if (w === this.w && h === this.h && insetB === this.insetB && insetT === this.insetT) return;
    // 쓰기 창·자판이 열린 동안은 구 자리를 바꾸지 않는다(자판이 보드 높이를 줄여도 점프 없음). 처음 재는 크기는 받는다
    if (this.write && this.w && this.h) {
      this.pendingSize = true;
      return;
    }
    this.pendingSize = false;
    this.w = w;
    this.h = h;
    this.insetB = insetB;
    this.insetT = insetT;
    this.settled = false;
    this.kick();
  }

  setItems(items: GlobeItem[]) {
    for (const it of items) {
      const hw = (GLOBE.cardW * it.k) / 2, hh = (GLOBE.cardH * it.k) / 2;
      const xs = it.cards.map((c) => c.rx), ys = it.cards.map((c) => c.ry);
      it.ext = it.cards.length
        ? { l: Math.min(...xs) - hw, r: Math.max(...xs) + hw, t: Math.min(...ys) - hh, b: Math.max(...ys) + hh }
        : { l: -GLOBE.labelW / 2, r: GLOBE.labelW / 2, t: -GLOBE.labelH / 2, b: GLOBE.labelH / 2 };
    }
    this.items = items;
    this.state = new WeakMap(); // React가 다시 그린 카드 자리를 모두 다시 쓴다
    this.sphere = this.root.querySelector<HTMLElement>('.g-sphere');
    this.sphereKey = '';
    if (Number.isNaN(this.phi) && items.length) {
      // 처음에는 가장 큰 주제를 정면에(집중이면 그 주제가 떠오른다)
      const big = items.reduce((b, it) => (it.weight > b.weight ? it : b));
      this.phi = big.lambda;
      if (this.focus && !this.focusId) this.focusId = big.id;
      // 처음 그릴 때는 펼친 상태 그대로(켜자마자 애니메이션을 돌리지 않는다: 앱이 막 뜰 때는 프레임이 드물다)
      this.snapProgress();
    }
    this.settled = false;
    this.kick();
  }

  /** paused: 메모 패널·목록이 열려 있거나 카드를 들어 올린 동안 자전을 멈춘다 */
  setMode(m: { write: boolean; reduced: boolean; paused?: boolean }) {
    const wasWrite = this.write;
    if (this.paused && !m.paused) this.idleAt = performance.now();
    if (wasWrite && !m.write) this.idleAt = performance.now();
    this.paused = !!m.paused;
    this.write = m.write;
    this.reduced = m.reduced;
    if (m.reduced) this.root.dataset.reduced = '1';
    else delete this.root.dataset.reduced;
    if (m.reduced) this.snapProgress();
    if (wasWrite && !m.write) {
      if (this.pendingSize) this.resize();
      this.release(0);
    }
    this.settled = false;
    this.kick();
  }

  get isFocus() {
    return this.focus;
  }

  /** 집중 ↔ 하늘. 집중하면 정면 주제가 떠올라 가운데서 펼쳐지고, 하늘로 가면 카드가 이름표로 빨려 들어가며 구 위 제자리로 돌아간다 */
  setFocus(on: boolean) {
    if (on && !this.focus) this.focusId = this.frontIndex() >= 0 ? this.items[this.frontIndex()]!.id : null;
    // 닫을 때는 그 주제가 정면에 오게 구를 돌려 받는다(돌아갈 자리가 보이게)
    if (!on && this.focus && this.focusId) this.rotateTo(this.focusId);
    this.focus = on;
    this.idleAt = performance.now();
    if (this.reduced) this.snapProgress();
    this.settled = false;
    this.kick();
  }

  /** 그 주제를 정면으로 돌리며 떠올려 펼친다(다른 주제가 펼쳐져 있었으면 그 주제는 구로 돌아간다) */
  focusTo(id: string) {
    if (!this.items.some((x) => x.id === id)) return;
    this.rotateTo(id);
    this.focus = true;
    this.focusId = id;
    this.idleAt = performance.now();
    if (this.reduced) this.snapProgress();
    this.settled = false;
    this.kick();
  }

  /** 그 주제가 정면에 오도록 짧은 방향으로 돌린다 */
  rotateTo(id: string) {
    const it = this.items.find((x) => x.id === id);
    if (!it || Number.isNaN(this.phi)) return;
    this.target = this.phi + wrapDeg(it.lambda - this.phi);
    this.omega = MOTION.snapOmega;
    this.startSpring(0);
  }

  // ---------- 물리 ----------

  private touch() {
    this.idleAt = performance.now();
  }

  /** 지금 φ에서 정면 주제의 인덱스 */
  private frontIndex(): number {
    return frontOf(this.items.map((it) => ({ delta: wrapDeg(it.lambda - this.phi), z: projectGlobe(it.lambda, it.beta, this.phi, { cx: 0, cy: 0, r: 1 }).z })));
  }

  /** 펼침 목표(쓰기 중에는 모두 구 위) */
  private liftTarget(id: string): number {
    return this.focus && !this.write && id === this.focusId ? 1 : 0;
  }

  /** 동작 줄이기: 진행값을 바로 목표로 */
  private snapProgress() {
    this.f = this.focus && !this.write ? 1 : 0;
    for (const it of this.items) this.lifts.set(it.id, this.liftTarget(it.id));
  }

  /** 보드(쓰기 아님) 자전을 지금 돌려도 되나 */
  private canDrift(now: number): boolean {
    return (
      !this.reduced && !this.paused && !this.held && this.mode === 'idle' && this.items.length > 0 && now - this.idleAt >= MOTION.autorotateResumeMs
    );
  }

  /** 자전이 쉬는 중이면 다시 갈 때 깨어나 프레임을 건다 */
  private armResume() {
    window.clearTimeout(this.resumeTimer);
    this.resumeTimer = 0;
    if (this.write || this.reduced || this.paused || this.held || this.mode !== 'idle' || !this.items.length || document.hidden) return;
    const wait = this.idleAt + MOTION.autorotateResumeMs - performance.now();
    if (wait > 0) this.resumeTimer = window.setTimeout(() => this.kick(), wait + 20);
  }

  private release(v: number) {
    if (Number.isNaN(this.phi)) return;
    const v0 = Math.max(-MOTION.maxVel, Math.min(MOTION.maxVel, v));
    const g = glideTarget(this.phi, v0, this.items.map((i) => i.lambda));
    this.target = g.target;
    this.omega = g.omega;
    this.startSpring(v0);
  }

  private startSpring(v0: number) {
    this.vel = v0;
    if (this.reduced) {
      this.phi = this.target;
      this.vel = 0;
      this.mode = 'idle';
    } else this.mode = 'spring';
    this.settled = false;
    this.kick();
  }

  private kick() {
    // 걸려 있는 프레임 요청은 다시 건다: 화면 크기가 바뀌는 사이에 요청이 실행되지 않고 사라지면
    // raf가 0으로 안 돌아와 이후 kick이 모두 무시되고 화면이 옛 크기 자리에 굳는다
    if (this.raf) cancelAnimationFrame(this.raf);
    else this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (Number.isNaN(this.phi)) return; // 아직 주제가 없다
    if (document.hidden) return; // 안 보이는 탭은 프레임을 걸지 않는다(배터리). 다시 보이면 onVisible이 깨운다
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    let busy = this.mode === 'drag' || this.mode === 'wheel';
    if (this.mode === 'spring') {
      const s = springStep(this.phi - this.target, this.vel, this.omega, dt);
      this.phi = this.target + s.x;
      this.vel = s.v;
      if (Math.abs(this.phi - this.target) < 0.05 && Math.abs(this.vel) < 1) {
        this.phi = this.target;
        this.vel = 0;
        this.mode = 'idle';
      } else busy = true;
    }
    // 진행값: 뒤 구 축소·흐림(f), 주제별 떠오름(lift). 약 0.4초
    const ft = this.focus && !this.write ? 1 : 0;
    if (this.f !== ft) {
      this.f += (ft - this.f) * Math.min(1, dt * 9);
      if (Math.abs(this.f - ft) < 0.004) this.f = ft;
      else busy = true;
    }
    for (const it of this.items) {
      const cur = this.lifts.get(it.id) ?? 0, lt = this.liftTarget(it.id);
      if (cur === lt) continue;
      let nv = cur + (lt - cur) * Math.min(1, dt * 9);
      if (Math.abs(nv - lt) < 0.004) nv = lt;
      else busy = true;
      this.lifts.set(it.id, nv);
    }
    // 자전: φ가 줄어 앞면 주제가 왼쪽 → 오른쪽으로 흐른다(왼쪽 테두리에서 나타나 오른쪽 테두리로 사라짐)
    let ambient = false;
    if (this.write && !this.reduced && this.mode === 'idle') {
      this.phi -= MOTION.autorotate * dt;
      busy = true;
    } else if (!this.write && this.canDrift(performance.now())) {
      this.phi -= MOTION.boardAutorotate * dt;
      // 집중 상태의 펼친 주제는 가운데 레이어에 고정: 뒤 구만 도니 "멈춤"(D22 기록·스냅 판정)에는 세지 않는다. 하늘 상태는 전체가 도니 움직이는 중
      if (this.focus && this.f === 1 && !busy) ambient = true;
      else busy = true;
    }
    const became = !busy && !this.settled;
    this.settled = !busy;
    this.render();
    if (busy) {
      this.root.dataset.moving = '1';
      this.raf = requestAnimationFrame(this.frame);
    } else {
      delete this.root.dataset.moving;
      if (became) this.opts.onSettle?.(this.root.dataset.front || null);
      if (ambient) this.raf = requestAnimationFrame(this.frame);
      else this.armResume();
    }
  };

  /** 이름표 크기(배율 1). 처음 한 번 재고, 못 재면 글자 수로 어림 */
  private tagSizeOf(it: GlobeItem): { w: number; h: number } {
    const tag = it.tag;
    if (!tag) return { w: 0, h: 0 };
    let s = this.tagSize.get(tag);
    if (!s) {
      const w = tag.offsetWidth, h = tag.offsetHeight;
      s = w > 0 && h > 0 ? { w, h } : { w: (tag.textContent?.length ?? 0) * GLOBE.labelPx + 20, h: GLOBE.labelPx * 1.6 };
      if (w > 0 && h > 0) this.tagSize.set(tag, s);
    }
    return s;
  }

  /** 펼친 카드 겉모양 크기(배율 1). 처음 한 번 잰다(못 재면 0 → 칸 크기를 쓴다) */
  private cardSizeOf(el: HTMLElement): { w: number; h: number } {
    let s = this.cardSize.get(el);
    if (!s) {
      const face = el.querySelector<HTMLElement>(".card") ?? el;
      s = { w: face.offsetWidth, h: face.offsetHeight };
      if (s.w > 0 && s.h > 0) this.cardSize.set(el, s);
    }
    return s;
  }

  private render() {
    if (!this.w || !this.h) return; // 크기를 못 쟀으면 그리지 않는다(NaN 방지)
    const base = globeViewport(this.w, this.h, MOTION.bottomPad + this.insetB);
    // 집중 상태에서는 뒤 구가 작고 연해진다(중심은 그대로)
    const zoom = 1 - (1 - GLOBE.focusZoom) * this.f;
    const vp = { ...base, r: base.r * zoom };
    const dim = 1 - (1 - GLOBE.focusDim) * this.f;
    this.drawSphere(vp, dim);
    const ps = this.items.map((it) => projectGlobe(it.lambda, it.beta, this.phi, vp));
    const lifts = this.items.map((it) => this.lifts.get(it.id) ?? 0);
    // 가운데 레이어: 이름표가 화면 정가운데
    const lx = this.w / 2, ly = this.h / 2;
    let focusI = this.focus ? this.items.findIndex((it) => it.id === this.focusId) : -1;
    if (this.focus && focusI < 0 && this.items.length) {
      // 펼친 주제가 사라졌으면(메모를 모두 옮김) 정면 주제로
      focusI = this.frontIndex();
      this.focusId = this.items[focusI]!.id;
    }
    const front = this.focus && focusI >= 0 ? focusI : frontOf(ps);
    // 펼친 이름표·카드 자리: 뒤 구 이름표 글자가 그 위에 겹치지 않게 막는다
    const block: ScreenBox[] = [];
    this.items.forEach((it, i) => {
      if (lifts[i]! < 0.5) return;
      const ts = this.tagSizeOf(it);
      block.push({ l: lx - ts.w / 2, r: lx + ts.w / 2, t: ly - ts.h / 2, b: ly + ts.h / 2 });
      for (const c of it.cards) {
        // 칸 크기와 실제 카드 크기 중 큰 쪽(감정 카드·사진 카드는 칸보다 클 수 있다)
        const cs = this.cardSizeOf(c.el);
        const hw = (Math.max(GLOBE.cardW, cs.w) * it.k) / 2 + GLOBE.cardGap, hh = (Math.max(GLOBE.cardH, cs.h) * it.k) / 2 + GLOBE.cardGap;
        block.push({ l: lx + c.rx - hw, r: lx + c.rx + hw, t: ly + c.ry - hh, b: ly + c.ry + hh });
      }
    });
    const shown = planLabels(
      this.items.map((it, i) => {
        const ts = this.tagSizeOf(it);
        // 떠오른 주제는 구 위 이름표 후보에서 뺀다
        return lifts[i]! > 0 ? { ...ps[i]!, z: -1, w: 0, h: 0 } : { x: ps[i]!.x, y: ps[i]!.y, z: ps[i]!.z, scale: ps[i]!.scale, w: ts.w, h: ts.h };
      }),
      vp,
      block,
    );
    this.items.forEach((it, i) => {
      const p = ps[i]!;
      const lift = lifts[i]!;
      const e = smooth01(lift);
      let x = p.x + (lx - p.x) * e, y = p.y + (ly - p.y) * e;
      let scale = p.scale + (1 - p.scale) * e;
      if (this.settled && lift === 1) {
        // 멈춘 펼친 주제는 정수 픽셀·정확한 배율로 다시 그려 글자 선명
        scale = 1;
        x = Math.round(x);
        y = Math.round(y);
      }
      const s = it.el.style;
      s.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
      const op = p.opacity * dim;
      s.opacity = (op + (1 - op) * e).toFixed(3);
      s.zIndex = String(lift > 0 ? 3000 + Math.round(lift * 100) : 1000 + Math.round(p.z * 500));

      const st = this.state.get(it.el) ?? { p: -1 };
      const lod: Lod = lift > 0.001 ? 'open' : p.z <= 0 ? 'back' : shown[i] ? 'label' : 'dot';
      if (st.lod !== lod) it.el.dataset.lod = lod;
      if (lod === 'open' && (Math.abs(st.p - lift) > 0.0005 || st.lod !== 'open')) {
        // 이름표 자리 ↔ 둘레 칸. 카드마다 조금씩 시차(빨려 들어갈 때 바깥 칸부터)
        const n = it.cards.length;
        it.cards.forEach((c, j) => {
          const ce = smooth01(lift * 1.3 - (0.3 * j) / Math.max(1, n));
          const cs = DOT_CARD + (it.k - DOT_CARD) * ce;
          const cx = c.dx + (c.rx - c.dx) * ce, cy = c.dy + (c.ry - c.dy) * ce;
          c.el.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) scale(${cs.toFixed(3)})`;
        });
      } else if (lod !== 'open' && st.lod === 'open') {
        for (const c of it.cards) c.el.style.transform = `translate3d(${c.dx}px, ${c.dy}px, 0)`;
      }
      this.state.set(it.el, { lod, p: lift });
    });
    const r = this.root;
    r.dataset.phi = this.phi.toFixed(2);
    r.dataset.front = front >= 0 ? this.items[front]!.id : '';
    r.dataset.delta = front >= 0 ? Math.abs(wrapDeg(this.items[front]!.lambda - this.phi)).toFixed(2) : '';
    r.dataset.settled = this.settled ? '1' : '0';
    if (r.dataset.mode !== (this.focus ? 'focus' : 'sky')) r.dataset.mode = this.focus ? 'focus' : 'sky';
  }

  /**
   * 구 원판(은은한 테두리·음영). 크기·자리·축소가 바뀔 때만 쓴다(집중 전환 0.4초 동안만).
   * transform 대신 left·top·크기로 둔다: 큰 반투명 원이 합성 레이어가 되면 헤드리스·저사양에서 프레임이 멈췄다
   */
  private drawSphere(vp: GlobeViewport, dim: number) {
    const el = this.sphere;
    if (!el) return;
    const key = `${vp.cx.toFixed(1)}|${vp.cy.toFixed(1)}|${vp.r.toFixed(1)}|${dim.toFixed(2)}`;
    if (key === this.sphereKey) return;
    this.sphereKey = key;
    const s = el.style;
    s.left = `${(vp.cx - vp.r).toFixed(1)}px`;
    s.top = `${(vp.cy - vp.r).toFixed(1)}px`;
    s.width = s.height = `${(vp.r * 2).toFixed(1)}px`;
    s.opacity = dim.toFixed(2);
  }

  // ---------- 제스처 ----------

  private bind(): () => void {
    const el = this.root;
    let pointer: { id: number; x: number } | null = null;
    let gesture: 'none' | 'pending' | 'drag' | 'lift' = 'none';
    let start = { x: 0, y: 0, t: 0 };
    let startTarget: Element | null = null;
    /** 끄는 동안의 (시각, φ) 표본(손 뗄 때 속도용) */
    let samples: { t: number; phi: number }[] = [];
    let liftTimer = 0;
    const clearLift = () => {
      window.clearTimeout(liftTimer);
      liftTimer = 0;
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointer) return; // 두 번째 손가락은 무시(조망 화면 없음)
      const target = e.target as Element;
      if (this.opts.shouldIgnore(target) || e.clientX < MOTION.edgeFree) return;
      pointer = { id: e.pointerId, x: e.clientX };
      this.held = true;
      this.touch();
      el.setPointerCapture?.(e.pointerId);
      gesture = 'pending';
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      startTarget = target;
      clearLift();
      liftTimer = window.setTimeout(() => {
        liftTimer = 0;
        if (gesture === 'pending' && startTarget && this.opts.onLift?.(startTarget, start.x, start.y)) gesture = 'lift';
      }, MOTION.liftMs);
      // 도는 중에 잡으면 그 자리에서 멈춘다
      if (this.mode === 'spring') {
        this.mode = 'drag';
        this.vel = 0;
      }
    };

    const move = (e: PointerEvent) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      const dx = e.clientX - pointer.x;
      pointer.x = e.clientX;
      this.touch();
      // 들어 올린 카드를 끄는 중에는 지구본이 돌지 않는다
      if (gesture === 'lift') return this.opts.onDrag?.(e.clientX, e.clientY);
      if (gesture === 'pending') {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= MOTION.tapSlop) return;
        clearLift();
        gesture = 'drag';
        this.mode = 'drag';
        this.vel = 0;
        samples = [{ t: performance.now(), phi: this.phi }];
        this.settled = false;
      }
      // 좌우만 돌린다(세로축 자전만). 위아래 움직임은 무시
      const now = performance.now();
      const d = -dx * MOTION.degPerPx;
      this.phi += d;
      samples.push({ t: now, phi: this.phi });
      if (samples.length > 2 && now - samples[0]!.t > MOTION.velWindowMs * 2) samples.shift();
      this.kick();
    };

    const up = (e: PointerEvent) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      pointer = null;
      this.held = false;
      this.touch();
      const g = gesture;
      gesture = 'none';
      clearLift();
      if (g === 'lift') this.opts.onDrop?.(e.clientX, e.clientY);
      if (g === 'pending' && performance.now() - start.t < 600 && startTarget) this.opts.onTap(startTarget, e.clientX, e.clientY);
      if (this.mode === 'drag') this.release(releaseVelocity(samples, performance.now()));
    };

    const cancel = (e: PointerEvent) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      pointer = null;
      this.held = false;
      this.touch();
      if (gesture === 'lift') this.opts.onDragCancel?.();
      gesture = 'none';
      clearLift();
      if (this.mode === 'drag') this.release(0);
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // 가로·세로 휠 모두 좌우 회전
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.mode = 'wheel';
      this.touch();
      this.vel = 0;
      this.settled = false;
      this.phi += d * MOTION.wheelDegPerPx;
      this.kick();
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => this.release(0), 140);
    };

    // iOS 사파리의 페이지 확대 제스처를 막는다
    const noGesture = (e: Event) => e.preventDefault();
    const noMenu = (e: Event) => e.preventDefault();
    const onResize = () => this.resize();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        this.resize();
        this.kick();
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    document.addEventListener('gesturestart', noGesture);
    window.addEventListener('resize', onResize);
    window.addEventListener('pageshow', onResize);
    document.addEventListener('visibilitychange', onVisible);
    window.visualViewport?.addEventListener('resize', onResize);
    // 인앱 브라우저는 처음 폭을 넓게 알렸다가 resize 이벤트 없이 줄이기도 한다 → 보드 크기를 직접 지켜본다(중심 쏠림 방지)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(el);
    return () => {
      clearLift();
      ro?.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', noMenu);
      document.removeEventListener('gesturestart', noGesture);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pageshow', onResize);
      document.removeEventListener('visibilitychange', onVisible);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }
}
