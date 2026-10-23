// 혼잡도 계산
// ─────────────────────────────────────────────────────────────
// 점수(0~100) = 평소 혼잡도(구역·요일·시간대) × 계절 배율(월) × 그날 예측 배율
//
//  · 평소 혼잡도 : data/zones.js 의 pattern (1·2·3 → 28·52·78점)
//  · 계절 배율   : data/seasonality.js (데이터랩 CSV)
//  · 예측 배율   : 관광지 집중률 예측 API (있을 때만)
//                 그날 예측값 ÷ 앞으로 30일 평균. 주말 효과가 예측에 이미
//                 들어 있어서, 예측이 있으면 평일 패턴을 기준으로 써요.
// ─────────────────────────────────────────────────────────────

import { SEASONALITY } from '../data/seasonality.js';
import { dayInfo, compactYmd } from './time.js';

export const LEVELS = [
  { key: 'low', label: '한산', min: 0 },
  { key: 'mid', label: '보통', min: 40 },
  { key: 'high', label: '혼잡', min: 65 },
  { key: 'peak', label: '매우 혼잡', min: 85 },
];

const BASE_SCORE = { 1: 28, 2: 52, 3: 78 };
// 배율을 그대로 곱하면 성수기엔 전부 빨간색이 돼서, 차이를 조금 줄여서 반영해요.
// (1이면 데이터 그대로, 0이면 무시)
const SEASON_WEIGHT = 0.6;
const FORECAST_WEIGHT = 0.7;
const NIGHT_SCORE = 10;
const SLOT_LABEL = { morning: '오전', afternoon: '오후', evening: '저녁', night: '심야' };

export function slotOf(hour) {
  if (hour >= 6 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 22) return 'evening';
  return 'night';
}

export function levelOf(score) {
  let level = LEVELS[0];
  for (const l of LEVELS) if (score >= l.min) level = l;
  return level;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// forecast = { zones: { [zoneId]: { 'YYYYMMDD': 0~100 } } } 또는 null
export function scoreZone(zone, ymd, hour, forecast) {
  const info = dayInfo(ymd);
  const slot = slotOf(hour);
  const seasonArr = SEASONALITY[zone.season] || SEASONALITY['기본'];
  const seasonRaw = seasonArr[info.month - 1];
  const season = 1 + SEASON_WEIGHT * (seasonRaw - 1);

  const rates = forecast?.zones?.[zone.id];
  const rate = rates?.[compactYmd(ymd)];
  let forecastFactor = null;
  if (typeof rate === 'number') {
    const values = Object.values(rates);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean > 0) forecastFactor = 1 + FORECAST_WEIGHT * (clamp(rate / mean, 0.5, 2) - 1);
  }

  const dayType = forecastFactor === null && info.weekend ? 'weekend' : 'weekday';
  const baseLevel = slot === 'night' ? null : zone.pattern[dayType][slot];
  const base = baseLevel ? BASE_SCORE[baseLevel] : NIGHT_SCORE;

  const score = Math.round(clamp(base * season * (forecastFactor ?? 1), 0, 100));
  return {
    score,
    level: levelOf(score),
    why: {
      dayType: info.weekend ? '주말·공휴일' : '평일',
      slot: SLOT_LABEL[slot],
      baseLevel,
      season,
      seasonRaw,
      month: info.month,
      forecastRate: typeof rate === 'number' ? rate : null,
      forecastFactor,
    },
  };
}

// 통제 일정이 그 시각에 걸리는지 ('YYYY-MM-DDTHH:MM' 문자열 비교)
export function activeClosures(closures, ymd, hour) {
  const at = `${ymd}T${String(hour).padStart(2, '0')}:00`;
  return closures.filter((c) => c.start <= at && at < c.end);
}
