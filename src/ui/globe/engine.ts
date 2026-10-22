import { GLOBE, globeViewport, projectGlobe, snapTarget, wrapDeg, type Projection } from '../../core/layout/globe';
import { MOTION } from './config';

export interface GlobeItem {
  id: string;
  lambda: number;
  beta: number;
  /** 회전하는 무리(또는 B안 타일) 컨테이너 */
  el: HTMLElement;
  /** A안: 세로 스크롤을 받는 무리 본문과 그 로컬 위·아래 끝(px) */
  body?: HTMLElement | null;
  top: number;
  bottom: number;
  /** 라벨만 보일 때 역배율로 키우는 이름표 */
  tag?: HTMLElement | null;
  /** 라벨만 보일 때 이름표가 화면에서 최소 이 배율로 보이게(A안 이름표 0.85, B안 타일 0.55) */
  tagFit: number;
  big: boolean;
  /** 처음 정면에 둘 후보(가장 큰 주제) */
  weight: number;
}

export interface EngineOptions {
  onTap: (target: Element) => void;
  onSettle: (frontId: string | null) => void;
  onMoveStart: () => void;
  /** 두 손가락: 오므리면 true(조망), 벌리면 false */
  onPinch: (zoomOut: boolean) => void;
  /** B안: 정면 판의 세로 스크롤 대상. 없으면 A안처럼 정면 무리 본문을 스크롤한다 */
  scrollTarget?: () => { el: HTMLElement; min: number; max: number } | null;
  shouldIgnore: (target: Element) => boolean;
}

type Lod = 'full' | 'summary' | 'dots' | 'label';

/**
 * 지구본 회전 엔진. φ·속도는 여기서만 들고, 프레임마다 무리 컨테이너 N개에 transform·opacity·z-index만
 * 직접 쓴다(React 재렌더 없음). 손을 떼면 관성 방향의 가장 가까운 주제로 임계 감쇠 스프링 스냅.
 */
export class GlobeEngine {
  private items: GlobeItem[] = [];
  private phi = NaN;
  private vel = 0;
  private mode: 'idle' | 'drag' | 'spring' | 'wheel' = 'idle';
  private target = 0;
  private zoom = 1;
  private zoomTarget = 1;
  /** 투영 중심 높이(화면 비율). 쓰기 모드에서는 쓰기 칸 아래로 내린다 */
  private cy: number = GLOBE.cyFrac;
  private cyTarget: number = GLOBE.cyFrac;
  private write = false;
  private reduced = false;
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = 0;
  private settled = false;
  private scrollY = 0;
  private scrollEl: HTMLElement | null = null;
  private wheelTimer = 0;
  private lods = new WeakMap<HTMLElement, Lod>();
  private tagScaled = new WeakSet<HTMLElement>();
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
    this.w = this.root.clientWidth || window.innerWidth;
    this.h = this.root.clientHeight || window.innerHeight;
    this.kick();
  }

  setItems(items: GlobeItem[]) {
    this.items = items;
    if (Number.isNaN(this.phi) && items.length) {
      // 처음에는 가장 큰 주제를 정면에
      this.phi = items.reduce((b, it) => (it.weight > b.weight ? it : b)).lambda;
    }
    if (this.mode === 'idle' && !this.write) this.settled = false;
    this.kick();
  }

  setMode(m: { write: boolean; overview: boolean; reduced: boolean }) {
    const wasWrite = this.write;
    this.write = m.write;
    this.reduced = m.reduced;
    this.zoomTarget = m.overview ? MOTION.overviewZoom : m.write ? MOTION.writeZoom : 1;
    this.cyTarget = m.write ? MOTION.writeCy : GLOBE.cyFrac;
    if (m.reduced) {
      this.zoom = this.zoomTarget;
      this.cy = this.cyTarget;
    }
    if (wasWrite && !m.write) this.release(0);
    this.settled = false;
    this.kick();
  }

  /** 그 주제가 정면에 오도록 돌린다 */
  rotateTo(id: string) {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    this.opts.onMoveStart();
    this.target = this.phi + wrapDeg(it.lambda - this.phi);
    this.startSpring(0);
  }

  // ---------- 물리 ----------

  private lambdas() {
    return this.items.map((i) => i.lambda);
  }

  private release(v: number) {
    const v0 = Math.max(-MOTION.maxVel, Math.min(MOTION.maxVel, v));
    this.target = snapTarget(this.phi + v0 * MOTION.inertiaLead, this.lambdas());
    this.vel = v0;
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
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (Number.isNaN(this.phi)) return; // 아직 주제가 없다
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    let busy = this.mode === 'drag' || this.mode === 'wheel';
    if (this.mode === 'spring') {
      const om = MOTION.snapOmega;
      const x = this.phi - this.target;
      // 임계 감쇠 스프링을 한 프레임 정확히 푼다(dt가 커도 넘치지 않게)
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
    if (this.zoom !== this.zoomTarget) {
      this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 9);
      if (Math.abs(this.zoom - this.zoomTarget) < 0.003) this.zoom = this.zoomTarget;
      else busy = true;
    }
    if (this.cy !== this.cyTarget) {
      this.cy += (this.cyTarget - this.cy) * Math.min(1, dt * 9);
      if (Math.abs(this.cy - this.cyTarget) < 0.001) this.cy = this.cyTarget;
      else busy = true;
    }
    if (this.scrollY !== 0 && this.mode !== 'idle' && !this.opts.scrollTarget) {
      // 회전이 시작되면 정면 무리 스크롤을 부드럽게 원위치
      this.scrollY *= Math.exp(-dt * 12);
      if (Math.abs(this.scrollY) < 0.5) this.scrollY = 0;
    }
    const nowSettled = !busy;
    const becameSettled = nowSettled && !this.settled;
    this.settled = nowSettled;
    this.render();
    if (busy) {
      this.root.dataset.moving = '1';
      this.raf = requestAnimationFrame(this.frame);
    } else {
      delete this.root.dataset.moving;
      if (becameSettled) this.opts.onSettle(this.front()?.id ?? null);
    }
  };

  private front(): GlobeItem | null {
    let best: GlobeItem | null = null;
    let bd = Infinity;
    for (const it of this.items) {
      const d = Math.abs(wrapDeg(it.lambda - this.phi));
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  private vp() {
    return { ...globeViewport(this.w, this.h, this.zoom), cy: this.h * this.cy };
  }

  private render() {
    const vp = this.vp();
    const front = this.front();
    const many = this.items.length >= MOTION.lodTopics;
    const overview = this.zoomTarget !== 1 && !this.write;
    for (const it of this.items) {
      const p = projectGlobe(it.lambda, it.beta, this.phi, vp);
      let { x, y, scale } = p;
      const isFront = it === front;
      if (this.settled && isFront && Math.abs(p.delta) < 1 && this.zoom === 1) {
        // 멈춘 정면 무리는 정확히 원래 크기·정수 픽셀로 → 글자가 선명하게 다시 그려진다
        scale = 1;
        x = Math.round(x);
        y = Math.round(y);
      }
      const s = it.el.style;
      s.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
      // 조망·쓰기 모드는 라벨만 보이므로 뒤쪽 라벨도 읽히게 바닥값을 둔다
      s.opacity = (overview || this.write ? Math.max(0.45, p.opacity) : p.opacity).toFixed(3);
      s.zIndex = String(1000 + Math.round(p.z * 500));
      const lod = this.lodFor(it, p, isFront, many, overview);
      if (this.lods.get(it.el) !== lod) {
        this.lods.set(it.el, lod);
        it.el.dataset.lod = lod;
      }
      if (it.tag) {
        if (lod === 'dots' || lod === 'label') {
          it.tag.style.transform = `translate(-50%, -50%) scale(${Math.min(3, Math.max(1, it.tagFit / scale)).toFixed(3)})`;
          this.tagScaled.add(it.tag);
        } else if (this.tagScaled.has(it.tag)) {
          it.tag.style.transform = '';
          this.tagScaled.delete(it.tag);
        }
      }
    }
    if (!this.opts.scrollTarget) this.applyFrontScroll(front);
    const r = this.root;
    r.dataset.phi = this.phi.toFixed(2);
    r.dataset.front = front?.id ?? '';
    r.dataset.delta = front ? Math.abs(wrapDeg(front.lambda - this.phi)).toFixed(2) : '';
    r.dataset.settled = this.settled ? '1' : '0';
  }

  private lodFor(it: GlobeItem, p: Projection, isFront: boolean, many: boolean, overview: boolean): Lod {
    if (this.write) return 'label';
    if (overview) return 'dots';
    if (many && p.side === 'back') return 'dots';
    if (it.big && !(isFront && p.side === 'front')) return 'summary';
    return 'full';
  }

  private applyFrontScroll(front: GlobeItem | null) {
    const el = front?.body ?? null;
    if (this.scrollEl && this.scrollEl !== el) {
      this.scrollEl.style.transform = '';
      this.scrollY = 0;
    }
    this.scrollEl = el;
    if (el) el.style.transform = this.scrollY ? `translate3d(0, ${this.scrollY.toFixed(1)}px, 0)` : '';
  }

  private scrollBy(dy: number) {
    const st = this.opts.scrollTarget?.();
    if (st) {
      this.scrollY = Math.max(st.min, Math.min(st.max, this.scrollY + dy));
      st.el.style.transform = `translate3d(0, ${this.scrollY.toFixed(1)}px, 0)`;
      return;
    }
    const f = this.front();
    if (!f) return;
    const p = projectGlobe(f.lambda, f.beta, this.phi, this.vp());
    const min = Math.min(0, this.h - MOTION.dockH - (p.y + f.bottom * p.scale));
    const max = Math.max(0, MOTION.topPad - (p.y + f.top * p.scale));
    this.scrollY = Math.max(min, Math.min(max, this.scrollY + dy));
    this.render();
  }

  /** B안: 판이 바뀌면 스크롤 원점부터 */
  resetScroll() {
    this.scrollY = 0;
  }

  // ---------- 제스처 ----------

  private bind(): () => void {
    const el = this.root;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: 'none' | 'pending' | 'h' | 'v' | 'pinch' = 'none';
    let start = { x: 0, y: 0, t: 0 };
    let startTarget: Element | null = null;
    let lastMove = 0;
    let pinchStart = 0;
    let pinchFired = false;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target as Element;
      if (this.opts.shouldIgnore(target)) return;
      if (pointers.size === 0 && e.clientX < MOTION.edgeFree) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        gesture = 'pending';
        start = { x: e.clientX, y: e.clientY, t: performance.now() };
        startTarget = target;
        // 도는 중에 잡으면 그 자리에서 멈춘다
        if (this.mode === 'spring') { this.mode = 'drag'; this.vel = 0; }
      } else if (pointers.size === 2) {
        gesture = 'pinch';
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        pinchFired = false;
      }
    };

    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (gesture === 'pinch') {
        if (pointers.size < 2 || pinchFired) return;
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinchStart || 1);
        if (ratio < 0.75 || ratio > 1.3) {
          pinchFired = true;
          this.opts.onPinch(ratio < 1);
        }
        return;
      }
      if (gesture === 'pending') {
        const tx = e.clientX - start.x, ty = e.clientY - start.y;
        if (Math.hypot(tx, ty) <= MOTION.axisSlop) return;
        gesture = Math.abs(tx) >= Math.abs(ty) ? 'h' : 'v';
        if (gesture === 'h') {
          this.mode = 'drag';
          this.vel = 0;
          lastMove = performance.now();
          if (this.opts.scrollTarget) this.scrollY = 0;
          this.opts.onMoveStart();
          this.settled = false;
        }
      }
      if (gesture === 'h') {
        const now = performance.now();
        const d = -dx * MOTION.degPerPx / Math.max(0.3, this.zoom);
        this.phi += d;
        const ms = now - lastMove;
        if (ms > 0) this.vel = this.vel * 0.4 + (d / (ms / 1000)) * 0.6;
        lastMove = now;
        this.kick();
      } else if (gesture === 'v') {
        this.scrollBy(dy);
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      const g = gesture;
      gesture = 'none';
      if (g === 'pending' || this.mode === 'drag') {
        if (g === 'pending' && performance.now() - start.t < 600 && startTarget) this.opts.onTap(startTarget);
        if (this.mode === 'drag') this.release(performance.now() - lastMove > 90 ? 0 : this.vel);
      }
    };

    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        gesture = 'none';
        if (this.mode === 'drag') this.release(0);
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (this.mode !== 'wheel') {
        this.opts.onMoveStart();
        if (this.opts.scrollTarget) this.scrollY = 0;
      }
      this.mode = 'wheel';
      this.vel = 0;
      this.settled = false;
      this.phi += d * MOTION.wheelDegPerPx;
      this.kick();
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => this.release(0), 140);
    };

    // iOS 사파리의 페이지 확대 제스처를 막는다(두 손가락은 조망 전환에 쓴다)
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
    return () => {
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
