// 날짜·시간 도우미. 날짜는 항상 'YYYY-MM-DD' 문자열(한국 시간)로 다뤄요.

import { HOLIDAYS } from '../data/holidays.js';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function kstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

function toUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(ymd, n) {
  const t = toUTC(ymd);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function dayInfo(ymd) {
  const dow = toUTC(ymd).getUTCDay();
  const holiday = HOLIDAYS.includes(ymd);
  return {
    dow,
    dayName: DAY_NAMES[dow],
    month: Number(ymd.slice(5, 7)),
    holiday,
    weekend: holiday || dow === 0 || dow === 6,
  };
}

export function formatDay(ymd) {
  const { dayName, holiday } = dayInfo(ymd);
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return `${m}월 ${d}일 (${dayName})${holiday ? ' 공휴일' : ''}`;
}

export const compactYmd = (ymd) => ymd.replaceAll('-', '');
