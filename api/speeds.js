// GET /api/speeds
// 경주 일대 도로 실시간 속도(ITS 교통소통정보)를 도로 이름별로 묶어서 알려줘요.
// ITS는 링크(도로 토막) 번호로만 주고 좌표가 없어서, 도로 이름으로 길찾기 경로와 맞춰요.
// 15분 동안은 같은 결과를 다시 써요 (월 3,000건 한도 → 최대 하루 96건).

import { fetchIts, kstStamp } from '../lib/itsFetch.js';
import { aggregateSpeeds } from '../lib/its.js';

export default async function handler(req, res) {
  const r = await fetchIts('trafficInfo', { drcType: 'all' }, 13 * 60 * 1000);
  if (!r.ok) {
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ ok: false, reason: r.reason });
  }
  const agg = aggregateSpeeds(r.items);
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
  return res.status(200).json({
    ok: true,
    fetched: kstStamp(),
    updated: agg.updated,
    total: r.items.length,
    links: agg.links,
    roads: agg.roads,
    fields: Object.keys(r.items[0] || {}), // 응답에 어떤 항목이 오는지 확인용
  });
}
