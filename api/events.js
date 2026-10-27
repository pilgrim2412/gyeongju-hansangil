// GET /api/events
// 경주 일대 돌발상황(사고·공사·행사·통제)을 ITS에서 받아 정리해요.
// 좌표가 같이 와서 지도에 바로 찍고, 차 길찾기에서 피할 곳으로 써요.
// 30분 동안은 같은 결과를 다시 써요 (월 3,000건 한도 → 최대 하루 48건).

import { fetchIts, kstStamp, diagnose } from '../lib/itsFetch.js';
import { normalizeEvent, inBox } from '../lib/its.js';

export default async function handler(req, res) {
  // ?debug=1 : 연결 점검 (캐시 없이 한 번 직접 불러봐요)
  if (req.query?.debug) {
    const [diag, r] = await Promise.all([diagnose(), fetchIts('eventInfo', { eventType: 'all' }, 0, { fresh: true })]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...diag, ok: r.ok, ms: r.ms, bytes: r.bytes, reason: r.reason, count: r.items?.length, fields: Object.keys(r.items?.[0] || {}), sample: r.items?.slice(0, 2) });
  }
  const r = await fetchIts('eventInfo', { eventType: 'all' }, 25 * 60 * 1000);
  if (!r.ok) {
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ ok: false, reason: r.reason });
  }
  const events = r.items.map(normalizeEvent).filter((e) => e && inBox(e.lat, e.lng));
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
  return res.status(200).json({
    ok: true,
    fetched: kstStamp(),
    total: r.items.length,
    events,
    fields: Object.keys(r.items[0] || {}), // 응답에 어떤 항목이 오는지 확인용
  });
}
