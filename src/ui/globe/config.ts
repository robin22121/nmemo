/** 지구본 보드 프로토타입 스위치(`?globe=1`)와 움직임 상수. 배치·투영 상수는 core/layout/globe.ts의 GLOBE. */

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const GLOBE_ON = params.get('globe') === '1';

/** A안: 무리 전체가 카드째 회전 / B안: 링에는 주제 타일만, 정면에 멈춘 주제만 평면 판으로 펼침 */
const DEFAULT_VARIANT: 'a' | 'b' = 'a';
export const VARIANT: 'a' | 'b' = params.get('variant') === 'b' ? 'b' : params.get('variant') === 'a' ? 'a' : DEFAULT_VARIANT;

/** 흐린 지구본 위 쓰기 칸 목업(`&write=1`) */
export const WRITE_MOCK = params.get('write') === '1';

export const MOTION = {
  /** 끌기 1px당 회전(°) — 화면 폭 375px을 끌면 약 105° */
  degPerPx: 0.28,
  wheelDegPerPx: 0.12,
  /** 손 뗀 뒤 스냅 스프링(임계 감쇠) 각진동수(1/s). 클수록 빨리 멈춘다 */
  snapOmega: 8.5,
  /** 관성: 손 뗄 때 속도 × 이 시간만큼 더 간 곳에서 가장 가까운 주제를 고른다(s) */
  inertiaLead: 0.25,
  maxVel: 900,
  /** 처음 이만큼 움직인 방향으로 축을 고정(px) */
  axisSlop: 8,
  /** 화면 왼쪽 가장자리는 뒤로가기 스와이프용으로 비운다(px) */
  edgeFree: 20,
  /** 쓰기 모드 배경 자동 회전(°/s) */
  autorotate: 5,
  /** 쓰기 모드 배경 지구본 배율(라벨 고리가 화면 안에 들어오게) */
  writeZoom: 0.6,
  /** 쓰기 모드 배경 지구본 중심 높이(화면 비율, 쓰기 칸 아래) */
  writeCy: 0.7,
  /** 조망(오므리기·전체 버튼) 때 지구본 배율 */
  overviewZoom: 0.42,
  /** 쓰기 모드 배경에 blur까지 걸지(기본은 반투명 덮개만) */
  composerBlur: false,
  /** 주제가 이만큼 이상이면 뒷면(|Δ|>90°) 무리는 라벨+점 구름 */
  lodTopics: 15,
  /** 이보다 큰 주제는 정면이 아닐 때 대표 카드 몇 장 + "+N" */
  bigTopic: 30,
  bigPreview: 6,
  /** 정면 무리 세로 스크롤이 닿는 위·아래 여백(px, 아래는 입력 바) */
  topPad: 56,
  dockH: 150,
} as const;
