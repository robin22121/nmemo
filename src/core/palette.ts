import type { Topic } from './types';

/** 무리 색 팔레트(옅은 배경 번짐에 어울리는 중간 채도) */
export const TOPIC_PALETTE = [
  '#e8a87c', '#85cdca', '#c38d9e', '#7fb069', '#8ea9e8', '#e6c35c', '#b58de8', '#e88e8e',
];

export function pickTopicColor(topics: Pick<Topic, 'color'>[]): string {
  const used = new Set(topics.map((t) => t.color));
  return TOPIC_PALETTE.find((c) => !used.has(c)) ?? TOPIC_PALETTE[topics.length % TOPIC_PALETTE.length]!;
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

const PALETTE_HSL = TOPIC_PALETTE.map(hexToHsl);
const S_MIN = Math.min(...PALETTE_HSL.map((c) => c[1]));
const S_MAX = Math.max(...PALETTE_HSL.map((c) => c[1]));
const L_MIN = Math.min(...PALETTE_HSL.map((c) => c[2]));
const L_MAX = Math.max(...PALETTE_HSL.map((c) => c[2]));

/** 주제 색 정리: 올바른 #rrggbb만 받고, 색상(hue)은 두고 채도·명도를 팔레트 범위로 맞춘다. 아니면 undefined */
export function normalizeTopicColor(v: unknown): string | undefined {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return undefined;
  const [h, s, l] = hexToHsl(v);
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  return hslToHex(h, clamp(s, S_MIN, S_MAX), clamp(l, L_MIN, L_MAX));
}
