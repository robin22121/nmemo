/** 지구본 보드 프로토타입 스위치(`?globe=1`)와 움직임 상수. 배치·투영 상수는 core/layout/globe.ts의 GLOBE. */

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const GLOBE_ON = params.get('globe') === '1';

/** 흐린 지구본 위 쓰기 칸 목업(`&write=1`) */
export const WRITE_MOCK = params.get('write') === '1';

export const MOTION = {
  /** 좌우 끌기 1px당 회전(°) — 화면 폭 375px에 약 105° */
  degPerPx: 0.28,
  wheelDegPerPx: 0.12,
  /** 손 뗀 뒤 스냅 스프링(임계 감쇠) 각진동수(1/s). 클수록 빨리 멈춘다 */
  snapOmega: 8.5,
  /** 관성: 손 뗄 때 속도 × 이 시간만큼 더 간 곳에서 가장 가까운 주제를 고른다(s) */
  inertiaLead: 0.25,
  maxVel: 900,
  /** 이만큼 움직이기 전까지는 탭으로 본다(px) */
  tapSlop: 8,
  /** 화면 왼쪽 가장자리는 뒤로가기 스와이프용으로 비운다(px) */
  edgeFree: 20,
  /** 쓰기 모드 배경 자동 회전(°/s) */
  autorotate: 5,
  /** 쓰기 모드 배경 지구본 배율(라벨 고리가 화면 안에 들어오게) */
  writeZoom: 0.6,
  /** 쓰기 모드 배경 지구본 중심 높이(화면 비율, 쓰기 칸 아래) */
  writeCy: 0.7,
  /** 쓰기 모드 배경에 blur까지 걸지(기본은 반투명 덮개만) */
  composerBlur: false,
  /** 펼친 카드가 닿는 화면 위 여백(px). 아래는 입력 바 위 */
  topPad: 10,
  bottomPad: 8,
} as const;
