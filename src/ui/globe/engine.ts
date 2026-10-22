import { fisheye, focusExpansion, globeViewport, GLOBE, pitchAt, projectGlobe, snapYaw, topicOpacity, wrapDeg } from '../../core/layout/globe';
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

/** 접힌 점에서 펼친 칸으로 갈 때 카드 크기(펼침 0 근처) */
const DOT_CARD = 0.16;

/**
 * 천구 회전 엔진. 끌기는 좌우만(φ). 시선 높이 θ는 φ에서 정해져(pitchAt) 정면으로 오는 주제의 높이를 따라간다.
 * 프레임마다 무리 컨테이너 N개에 transform·opacity·z-index를 직접 쓰고(React 재렌더 없음),
 * 카드 하나하나는 펼쳐진 무리만 쓴다. 크기에는 화면 중심 어안 배율을 곱한다.
 * 손을 떼면 관성 방향에서 경도가 가장 가까운 주제로 임계 감쇠 스프링 스냅.
 */
export class GlobeEngine {
  private items: GlobeItem[] = [];
  private phi = NaN;
  private theta = 0;
  private vel = 0;
  private mode: 'idle' | 'drag' | 'spring' | 'wheel' = 'idle';
  private target = 0;
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
  private last = 0;
  private settled = false;
  private wheelTimer = 0;
  private state = new WeakMap<HTMLElement, { lod?: Lod; e: number; ls: number }>();
  private off: () => void;

  constructor(private root: HTMLElement, private opts: EngineOptions) {
    this.off = this.bind();
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.wheelTimer);
    this.off();
  }

  resize() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
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

  setMode(m: { write: boolean; reduced: boolean }) {
    const wasWrite = this.write;
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
    this.startSpring(0);
  }

  // ---------- 물리 ----------

  private release(v: number) {
    const v0 = Math.max(-MOTION.maxVel, Math.min(MOTION.maxVel, v));
    const t = snapYaw(this.phi + v0 * MOTION.inertiaLead, this.items.map((i) => i.lambda));
    this.target = this.phi + wrapDeg(t - this.phi);
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
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    let busy = this.mode === 'drag' || this.mode === 'wheel';
    if (this.mode === 'spring') {
      // 임계 감쇠 스프링을 한 프레임 정확히 푼다(dt가 커도 넘치지 않게)
      const om = MOTION.snapOmega;
      const x = this.phi - this.target;
      const e = Math.exp(-om * dt);
      const c = this.vel + om * x;
      this.phi = this.target + (x + c * dt) * e;
      this.vel = (c - om * (x + c * dt)) * e;
      if (Math.abs(this.phi - this.target) < 0.02 && Math.abs(this.vel) < 0.5) {
        this.phi = this.target;
        this.vel = 0;
        this.mode = 'idle';
      } else busy = true;
    }
    if (this.write && !this.reduced && this.mode === 'idle') {
      this.phi += MOTION.autorotate * dt;
      busy = true;
    }
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
    }
  };

  private render() {
    this.theta = pitchAt(this.phi, this.items);
    const vp = { ...globeViewport(this.w, this.h, this.zoom), cy: this.h * this.cy };
    const fv = { cx: vp.cx, cy: vp.cy, width: this.w, height: this.h };
    // 집중 보기: 펼치는 건 φ를 감싸는 두 주제뿐(떠나는 주제는 접히고 다가오는 주제는 펼쳐짐). 하늘 보기·쓰기는 모두 접힘
    const raw = this.write ? this.items.map(() => 0) : focusExpansion(this.phi, this.items);
    // f: 하늘(0) ↔ 집중(1). 카드는 f를 따라 빨려 들어가고/터져 나오고, 다른 주제 흐림(dimF)은 카드보다 늦게 걷히고 먼저 깔린다
    const f = this.f;
    const dimF = Math.min(1, f * 2) ** 2 * (3 - 2 * Math.min(1, f * 2));
    const ps = this.items.map((it) => projectGlobe(it.lambda, it.beta, this.phi, this.theta, vp));
    let front = -1;
    let focusI = -1;
    ps.forEach((p, i) => {
      if (front < 0 || p.dist < ps[front]!.dist) front = i;
      if (raw[i]! > 0.5 && (focusI < 0 || raw[i]! > raw[focusI]!)) focusI = i;
    });
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
    let lastMove = 0;
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
      // 들어 올린 카드를 끄는 중에는 지구본이 돌지 않는다
      if (gesture === 'lift') return this.opts.onDrag?.(e.clientX, e.clientY);
      if (gesture === 'pending') {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= MOTION.tapSlop) return;
        clearLift();
        gesture = 'drag';
        this.mode = 'drag';
        this.vel = 0;
        lastMove = performance.now();
        this.settled = false;
      }
      // 좌우만 돌린다. 위아래 움직임은 무시(높이는 주제를 따라간다)
      const now = performance.now();
      const d = -dx * MOTION.degPerPx / Math.max(0.3, this.zoom);
      this.phi += d;
      const ms = now - lastMove;
      if (ms > 0) this.vel = this.vel * 0.4 + (d / (ms / 1000)) * 0.6;
      lastMove = now;
      this.kick();
    };

    const up = (e: PointerEvent) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      pointer = null;
      const g = gesture;
      gesture = 'none';
      clearLift();
      if (g === 'lift') this.opts.onDrop?.(e.clientX, e.clientY);
      if (g === 'pending' && performance.now() - start.t < 600 && startTarget) this.opts.onTap(startTarget, e.clientX, e.clientY);
      if (this.mode === 'drag') this.release(performance.now() - lastMove > 90 ? 0 : this.vel);
    };

    const cancel = (e: PointerEvent) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      pointer = null;
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
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    document.addEventListener('gesturestart', noGesture);
    window.addEventListener('resize', onResize);
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
    };
  }
}
