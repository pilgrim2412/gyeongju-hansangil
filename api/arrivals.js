// POST /api/arrivals
// 버스 정류장의 실시간 도착 정보 (국토교통부 TAGO)
//
// 요청: { stops: [{ key, lat, lng, name, routes: ['10', '600'] }] }  (최대 8개)
// 1) TAGO 버스정류소정보: 좌표 근처 정류장 중 이름이 맞는 가장 가까운 정류장 ID 찾기
// 2) TAGO 버스도착정보: 그 정류장에 오는 버스들 중 routes에 있는 노선만 골라서
//    { routeNo, minutes(도착까지 분), stopsAway(남은 정류장 수) } 로 돌려줘요.
// 공공데이터포털에서 두 API 모두 활용신청이 필요해요 (같은 인증키 DATA_GO_KR_SERVICE_KEY 사용).

import { distanceM } from '../lib/geo.js';

const STOP_URL = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';
const ARRIVAL_URL = 'https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList';
const MAX_STOPS = 8;

const normName = (s) => String(s || '').replace(/[\s.·()]/g, '').replace(/정류장|정류소|방면.*$/g, '');
const normRoute = (s) => String(s ?? '').replace(/[^0-9A-Za-z가-힣-]/g, '').replace(/^경주/, '');

async function callTago(url, key, params) {
  const qs = new URLSearchParams({ ...params, _type: 'json', numOfRows: '50', pageNo: '1' });
  const r = await fetch(`${url}?serviceKey=${encodeURIComponent(key)}&${qs}`);
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const tag = ['returnAuthMsg', 'resultMsg', 'errMsg']
      .map((t) => text.match(new RegExp(`<${t}>([^<]+)<`)))
      .find(Boolean);
    throw new Error(tag ? tag[1] : `응답을 읽지 못했어요 (${r.status})`);
  }
  const header = data.response?.header;
  if (header && !['00', '0000', 0, '0'].includes(header.resultCode)) {
    throw new Error(header.resultMsg || '알 수 없는 오류');
  }
  let items = data.response?.body?.items?.item ?? [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  return items;
}

async function findStop(key, stop) {
  const items = await callTago(STOP_URL, key, { gpsLati: String(stop.lat), gpsLong: String(stop.lng) });
  const near = items
    .map((s) => ({
      nodeId: s.nodeid,
      cityCode: s.citycode,
      name: s.nodenm,
      dist: distanceM([stop.lat, stop.lng], [Number(s.gpslati), Number(s.gpslong)]),
    }))
    .filter((s) => s.nodeId && Number.isFinite(s.dist))
    .sort((a, b) => a.dist - b.dist);
  const want = normName(stop.name);
  // 이름이 같은 정류장(길 건너편 방향도 이름이 같아서, 그중 가장 가까운 쪽) → 없으면 아주 가까운 정류장
  return (
    near.find((s) => want && normName(s.name) === want && s.dist <= 250) ||
    near.find((s) => want && (normName(s.name).includes(want) || want.includes(normName(s.name))) && s.dist <= 250) ||
    near.find((s) => s.dist <= 60) ||
    null
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 받아요.' });
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'DATA_GO_KR_SERVICE_KEY가 설정되지 않았어요.' });

  const stops = (Array.isArray(req.body?.stops) ? req.body.stops : [])
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .slice(0, MAX_STOPS);

  const arrivalCache = new Map(); // 같은 정류장은 한 번만 물어보기
  const results = {};
  let firstError = null;

  await Promise.all(stops.map(async (s) => {
    const k = String(s.key ?? `${s.lat},${s.lng}`);
    try {
      const stop = await findStop(key, s);
      if (!stop) { results[k] = { stop: null, arrivals: [] }; return; }
      if (!arrivalCache.has(stop.nodeId)) {
        arrivalCache.set(stop.nodeId, callTago(ARRIVAL_URL, key, { cityCode: String(stop.cityCode), nodeId: stop.nodeId }));
      }
      const items = await arrivalCache.get(stop.nodeId);
      const want = (Array.isArray(s.routes) ? s.routes : []).map(normRoute).filter(Boolean);
      const arrivals = items
        .map((a) => ({
          routeNo: String(a.routeno ?? ''),
          minutes: Math.max(0, Math.round(Number(a.arrtime) / 60)),
          stopsAway: Number(a.arrprevstationcnt),
        }))
        .filter((a) => Number.isFinite(a.minutes) && (!want.length || want.includes(normRoute(a.routeNo))))
        .sort((a, b) => a.minutes - b.minutes);
      results[k] = { stop: { nodeId: stop.nodeId, name: stop.name, distM: Math.round(stop.dist) }, arrivals };
    } catch (e) {
      firstError ??= e.message;
      results[k] = { error: e.message, arrivals: [] };
    }
  }));

  res.setHeader('Cache-Control', 's-maxage=20');
  return res.status(200).json({
    ok: !firstError || Object.values(results).some((r) => !r.error),
    reason: firstError ? `실시간 도착 정보를 받지 못했어요: ${firstError}` : null,
    results,
  });
}
