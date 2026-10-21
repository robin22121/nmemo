import type { Topic } from './types';

/** 무리 색 팔레트(옅은 배경 번짐에 어울리는 중간 채도) */
export const TOPIC_PALETTE = [
  '#e8a87c', '#85cdca', '#c38d9e', '#7fb069', '#8ea9e8', '#e6c35c', '#b58de8', '#e88e8e',
];

export function pickTopicColor(topics: Pick<Topic, 'color'>[]): string {
  const used = new Set(topics.map((t) => t.color));
  return TOPIC_PALETTE.find((c) => !used.has(c)) ?? TOPIC_PALETTE[topics.length % TOPIC_PALETTE.length]!;
}
