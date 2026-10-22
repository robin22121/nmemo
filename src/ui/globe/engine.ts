import { fisheye, focusExpansion, globeViewport, GLOBE, pitchAt, projectGlobe, topicOpacity, wrapDeg, type RingBox } from '../../core/layout/globe';
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

type Lod = 'open' | 'dots' | 'label';

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

/** 이름표를 화면 정가운데 둘 때 카드가 들어갈 화면 안 범위(이름표 중심 기준). 아래는 + 버튼 여백 + safe-area 아래 inset */
export function boxOf(w: number, h: number, inset = 0): RingBox {
  return { left: -w / 2 + 8, right: w / 2 - 8, top: -h / 2 + MOTION.topPad, bottom: h / 2 - MOTION.bottomPad - inset };
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
 * 손 뗀 뒤 갈 곳과 감속률. φ + v·inertiaLead(관성으로 멈출 곳)에 가장 가까운 주제로 간다.
 * 앞쪽 주제로 갈 때는 감속률 ω = |v|/거리(범위 안): 속도가 남은 거리에 비례해 줄어 처음 빠르고 정가운데에 가까울수록 느려진다.
 * ω ≥ |v|/거리라서 넘치지 않는다. 이 속도로 넘칠 만큼 가까운 앞 주제는 건너뛴다. 느리거나 뒤쪽 주제면 snapOmega.
 */
export function glideTarget(phi: number, v: number, lambdas: number[]): { target: number; omega: number } {
  const lead = phi + v * MOTION.inertiaLead;
  const sp = Math.abs(v);
  const glide = sp >= MOTION.glideMinVel;
  let best = phi;
  let bd = Infinity;
  for (const l of lambdas)
    for (const k of [-360, 0, 360]) {
      const t = phi + wrapDeg(l - phi) + k;
      const ahead = (t - phi) * Math.sign(v);
      if (glide && ahead >= 0 && ahead < sp / MOTION.glideOmegaMax) continue;
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

/** 크기 0 측정 뒤 다시 재는 최대 프레임 수 */
const MEASURE_RETRIES = 60;

/** 접힌 점에서 펼친 칸으로 갈 때 카드 크기(펼침 0 근처) */
const DOT_CARD = 0.16;

/**
 * 천구 회전 엔진. 끌기는 좌우만(φ). 시선 높이 θ는 φ에서 정해져(pitchAt) 정면으로 오는 주제의 높이를 따라간다.
 * 프레임마다 무리 컨테이너 N개에 transform·opacity·z-index를 직접 쓰고(React 재렌더 없음),
 * 카드 하나하나는 펼쳐진 무리만 쓴다. 크기에는 화면 중심 어안 배율을 곱한다.
 * 손을 떼면 그 속도를 이어받아 관성으로 멈출 곳에 가장 가까운 주제로 감속하며 멈춘다(임계 감쇠 스프링, D34).
 */
export class GlobeEngine {
  private items: GlobeItem[] = [];
  private phi = NaN;
  private theta = 0;
  private vel = 0;
  private mode: 'idle' | 'drag' | 'spring' | 'wheel' = 'idle';
  private target = 0;
  /** 지금 스프링의 각진동수(1/s). 밀고 난 감속은 손 뗀 속도·거리로 정한다 */
  private omega: number = MOTION.snapOmega;
  private zoom = 1;
  private zoomTarget = 1;
  /** 투영 중심 높이(화면 비율). 쓰기 모드에서는 쓰기 칸 아래로 내린다 */
  private cy = 0.5;
  private cyTarget = 0.5;
  private write = false;
  private reduced = false;
  /** 집중 보기(가운데 주제만 펼침) / 하늘 보기(모두 접힘). f는 그 사이 진행값 */
  private focus = true;
  private f = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private measureRaf = 0;
  private last = 0;
  private settled = false;
  private wheelTimer = 0;
  /** 배경 주제만 도는 각(°). 집중 상태에서 정면 주제는 φ에 고정되고 나머지는 φ+bg로 그려진다. 하늘·쓰기에서는 φ에 합친다 */
  private bg = 0;
  /** 손가락·휠을 마지막으로 댄 시각. 자전은 이후 autorotateResumeMs가 지나야 다시 간다 */
  private idleAt = performance.now();
  private held = false;
  private paused = false;
  private resumeTimer = 0;
  private state = new WeakMap<HTMLElement, { lod?: Lod; e: number; ls: number }>();
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
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
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
    if (Number.isNaN(this.phi) && items.length) {
      // 처음에는 가장 큰 주제를 정가운데에
      this.phi = items.reduce((b, it) => (it.weight > b.weight ? it : b)).lambda;
    }
    this.settled = false;
    this.kick();
  }

  /** paused: 메모 패널·목록이 열려 있거나 카드를 들어 올린 동안 자전을 멈춘다 */
  setMode(m: { write: boolean; reduced: boolean; paused?: boolean }) {
    const wasWrite = this.write;
    if (m.write && this.bg) this.foldBg();
    if (this.paused && !m.paused) this.idleAt = performance.now();
    if (wasWrite && !m.write) this.idleAt = performance.now();
    this.paused = !!m.paused;
    this.write = m.write;
    this.reduced = m.reduced;
    this.zoomTarget = m.write ? MOTION.writeZoom : 1;
    this.cyTarget = m.write ? MOTION.writeCy : 0.5;
    if (m.reduced) this.root.dataset.reduced = '1';
    else delete this.root.dataset.reduced;
    if (m.reduced) {
      this.f = this.focus ? 1 : 0;
      this.zoom = this.zoomTarget;
      this.cy = this.cyTarget;
    }
    if (wasWrite && !m.write) this.release(0);
    this.settled = false;
    this.kick();
  }

  get isFocus() {
    return this.focus;
  }

  /** 집중 ↔ 하늘. 하늘로 가면 카드가 이름표로 빨려 들어가고 다른 주제가 또렷해진다 */
  setFocus(on: boolean) {
    this.focus = on;
    this.idleAt = performance.now();
    if (this.reduced) this.f = on ? 1 : 0;
    this.settled = false;
    this.kick();
  }

  /** 그 주제를 정가운데로 돌리고 집중 보기로(메모가 이름표에서 터져 나온다) */
  focusTo(id: string) {
    this.rotateTo(id);
    this.setFocus(true);
  }

  /** 그 주제가 정가운데 오도록 짧은 방향으로 돌린다(높이는 따라온다) */
  rotateTo(id: string) {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    this.target = this.phi + wrapDeg(it.lambda - this.phi);
    this.omega = MOTION.snapOmega;
    this.startSpring(0);
  }

  // ---------- 물리 ----------

  private foldBg() {
    this.phi += this.bg;
    this.bg = 0;
  }

  private touch() {
    this.idleAt = performance.now();
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
    let ambient = false;
    if (this.bg && this.mode !== 'idle') {
      // 직접 돌리기·스냅이 시작되면 배경 어긋남은 걷힌다(경도로 고르는 스냅과 눈에 보이는 자리를 맞춘다)
      this.bg = wrapDeg(this.bg) * Math.exp(-8 * dt);
      if (Math.abs(this.bg) < 0.05) this.bg = 0;
      else busy = true;
    }
    if (this.write && !this.reduced && this.mode === 'idle') {
      this.bg += MOTION.autorotate * dt;
      busy = true;
    } else if (!this.write && this.canDrift(performance.now())) {
      this.bg += MOTION.boardAutorotate * dt;
      // 집중 상태의 정면 주제는 제자리: 배경만 도니 "멈춤"(D22 기록·스냅 판정)에는 세지 않는다. 하늘 상태는 전체가 도니 움직이는 중
      if (this.focus && this.f === 1) ambient = true;
      else busy = true;
    }
    if (this.bg && (this.write || this.f === 0)) this.foldBg();
    const ft = this.focus ? 1 : 0;
    if (this.f !== ft) {
      // 약 0.4초에 걸쳐 빨려 들어가기/터져 나오기
      this.f += (ft - this.f) * Math.min(1, dt * 9);
      if (Math.abs(this.f - ft) < 0.004) this.f = ft;
      else busy = true;
    }
    for (const k of ['zoom', 'cy'] as const) {
      const tk = k === 'zoom' ? this.zoomTarget : this.cyTarget;
      if (this[k] === tk) continue;
      this[k] += (tk - this[k]) * Math.min(1, dt * 9);
      if (Math.abs(this[k] - tk) < 0.002) this[k] = tk;
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

  private render() {
    if (!this.w || !this.h) return; // 크기를 못 쟀으면 그리지 않는다(NaN 방지)
    this.theta = pitchAt(this.phi, this.items);
    const vp = { ...globeViewport(this.w, this.h, this.zoom), cy: this.h * this.cy };
    const fv = { cx: vp.cx, cy: vp.cy, width: this.w, height: this.h };
    // 집중 보기: 펼치는 건 φ를 감싸는 두 주제뿐(떠나는 주제는 접히고 다가오는 주제는 펼쳐짐). 하늘 보기·쓰기는 모두 접힘
    const raw = this.write ? this.items.map(() => 0) : focusExpansion(this.phi, this.items);
    // f: 하늘(0) ↔ 집중(1). 카드는 f를 따라 빨려 들어가고/터져 나오고, 다른 주제 흐림(dimF)은 카드보다 늦게 걷히고 먼저 깔린다
    const f = this.f;
    const dimF = Math.min(1, f * 2) ** 2 * (3 - 2 * Math.min(1, f * 2));
    // 정면 주제(펼침 가중치 raw·f)는 φ에 고정, 나머지는 배경 자전 bg만큼 더 간다
    const ps = this.items.map((it, i) => projectGlobe(it.lambda, it.beta, this.phi + this.bg * (1 - Math.min(1, raw[i]! * this.f)), this.theta, vp));
    let front = -1;
    let focusI = -1;
    ps.forEach((p, i) => {
      if (front < 0 || p.dist < ps[front]!.dist) front = i;
      if (raw[i]! > 0.5 && (focusI < 0 || raw[i]! > raw[focusI]!)) focusI = i;
    });
    if (this.bg !== 0 && this.focus && this.f > 0.5 && focusI >= 0) front = focusI; // 도는 배경이 정면 자리를 지나가도 정면은 고정된 주제
    // 집중된 주제의 펼친 고리 영역(화면 좌표): 그 안에 겹치는 다른 주제는 더 흐리게
    const fr = focusI >= 0 ? this.items[focusI]!.ext : null;
    const fp = focusI >= 0 ? ps[focusI]! : null;
    this.items.forEach((it, i) => {
      const p = ps[i]!;
      const e = raw[i]! * f;
      // 펼칠수록 원래 크기로, 그리고 화면 중심에 가까울수록 크게(어안)
      const mC = fisheye(p.x, p.y, fv);
      let scale = (p.scale + (1 - p.scale) * e) * mC;
      let { x, y } = p;
      if (this.settled && e === 1) {
        // 멈춘 정가운데 주제는 정수 픽셀·정확한 배율로 다시 그려 글자 선명
        scale = 1;
        x = Math.round(x);
        y = Math.round(y);
      }
      const s = it.el.style;
      s.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
      let op = topicOpacity(p.opacity, raw[i]!, dimF);
      if (fr && fp && i !== focusI && p.x > fp.x + fr.l && p.x < fp.x + fr.r && p.y > fp.y + fr.t && p.y < fp.y + fr.b) op *= 1 - 0.7 * dimF;
      s.opacity = (this.write ? Math.max(0.45, op) : op).toFixed(3);
      s.zIndex = String(1000 + Math.round(p.z * 500) + (raw[i]! > 0 ? 600 + Math.round(raw[i]! * 100) : 0));

      const st = this.state.get(it.el) ?? { e: -1, ls: 0 };
      const lod: Lod = e > 0.001 ? 'open' : this.write ? 'label' : 'dots';
      if (st.lod !== lod) it.el.dataset.lod = lod;
      if (lod === 'open' && (this.mode !== 'idle' || Math.abs(st.e - e) > 0.001 || st.lod !== 'open' || this.settled)) {
        // 점 구름 ↔ 둘레 칸. 카드마다 조금씩 시차(빨려 들어갈 때 바깥 칸부터), 자기 화면 자리의 어안 배율
        const n = it.cards.length;
        it.cards.forEach((c, j) => {
          const fj = Math.max(0, Math.min(1, f * 1.3 - (0.3 * j) / Math.max(1, n)));
          const ej = raw[i]! * fj;
          const ce = ej * ej * (3 - 2 * ej);
          const cs = DOT_CARD + (it.k - DOT_CARD) * ce;
          const lx = c.dx + (c.rx - c.dx) * ce, ly = c.dy + (c.ry - c.dy) * ce;
          const m = fisheye(x + lx * scale, y + ly * scale, fv) / mC;
          c.el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) scale(${(cs * m).toFixed(3)})`;
        });
      } else if (lod !== 'open' && st.lod === 'open') {
        for (const c of it.cards) c.el.style.transform = `translate3d(${c.dx}px, ${c.dy}px, 0)`;
      }
      // 이름표: 가운데에서는 원래 크기(평면 보드 이름표와 같은 15px), 멀어지면 읽히게 역배율(최대 2.6배)
      const ls = Math.min(2.6, Math.max(1, 0.95 / scale));
      const lsChanged = Math.abs(ls - st.ls) > 0.01;
      if (it.tag && lsChanged) it.tag.style.transform = `translate(-50%, -50%) scale(${ls.toFixed(3)})`;
      if (st.e < 0 || e.toFixed(2) !== st.e.toFixed(2)) it.el.dataset.e = e.toFixed(2);
      this.state.set(it.el, { lod, e, ls: lsChanged ? ls : st.ls });
    });
    const r = this.root;
    r.dataset.phi = this.phi.toFixed(2);
    r.dataset.pitch = this.theta.toFixed(2);
    r.dataset.front = front >= 0 ? this.items[front]!.id : '';
    r.dataset.delta = front >= 0 ? ps[front]!.dist.toFixed(2) : '';
    r.dataset.settled = this.settled ? '1' : '0';
    if (r.dataset.mode !== (this.focus ? 'focus' : 'sky')) r.dataset.mode = this.focus ? 'focus' : 'sky';
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
      // 좌우만 돌린다. 위아래 움직임은 무시(높이는 주제를 따라간다)
      const now = performance.now();
      const d = -dx * MOTION.degPerPx / Math.max(0.3, this.zoom);
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
