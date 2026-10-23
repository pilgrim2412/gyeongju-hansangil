// GET /api/forecast
// 한국관광공사 「관광지 집중률 방문자 추이 예측 정보」에서 경주시 관광지의
// 앞으로 30일 집중률(0~100)을 받아 구역별로 묶어서 돌려줘요.
// 결과는 Vercel이 6시간 동안 저장해 두고 재사용해서, 하루 호출 수가 아주 적어요.
// 키가 없거나 실패하면 { ok: false } 를 돌려주고, 화면은 평소 패턴으로 계산해요.

import { ATTRACTIONS } from '../data/attractions.js';

// 마이페이지의 이 데이터 「End Point」와 다르면 Vercel 환경 변수 FORECAST_API_URL로 바꿀 수 있어요.
const DEFAULT_URL = 'https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList';
const GYEONGJU = { areaCd: '47', signguCd: '47130' };

function zoneForName(name) {
  const hit = ATTRACTIONS.find((a) => a.zone && a.forecast?.some((k) => name.includes(k)));
  return hit ? hit.zone : null;
}

async function fetchPage(url, key, pageNo) {
  const params = new URLSearchParams({
    numOfRows: '1000',
    pageNo: String(pageNo),
    MobileOS: 'WEB',
    MobileApp: 'gyeongju-hansangil',
    areaCd: GYEONGJU.areaCd,
    signguCd: GYEONGJU.signguCd,
    _type: 'json',
  });
  // 인증키는 「일반 인증키(Decoding)」 값을 넣어 두면 여기서 인코딩해요.
  const r = await fetch(`${url}?serviceKey=${encodeURIComponent(key)}&${params}`);
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
  if (header && !['0000', '00', 0, '0'].includes(header.resultCode)) {
    throw new Error(header.resultMsg || '알 수 없는 오류');
  }
  const body = data.response?.body || {};
  let items = body.items?.item || [];
  if (!Array.isArray(items)) items = [items];
  return { items, total: Number(body.totalCount || items.length) };
}

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    return res.status(200).json({ ok: false, reason: 'DATA_GO_KR_SERVICE_KEY가 설정되지 않았어요.' });
  }
  const url = process.env.FORECAST_API_URL || DEFAULT_URL;

  try {
    const first = await fetchPage(url, key, 1);
    let items = first.items;
    for (let page = 2; items.length < first.total && page <= 5; page++) {
      items = items.concat((await fetchPage(url, key, page)).items);
    }

    const zones = {};
    const names = new Set();
    const unmatched = new Set();
    for (const it of items) {
      const name = String(it.tAtsNm || '').trim();
      const rate = Number(it.cnctrRate);
      const ymd = String(it.baseYmd || '');
      if (!name || !Number.isFinite(rate) || ymd.length !== 8) continue;
      names.add(name);
      const zone = zoneForName(name);
      if (!zone) { unmatched.add(name); continue; }
      zones[zone] ??= {};
      zones[zone][ymd] = Math.max(zones[zone][ymd] ?? 0, rate);
    }

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    return res.status(200).json({
      ok: true,
      updated: new Date().toISOString(),
      zones,
      names: [...names].sort(),
      unmatched: [...unmatched].sort(),
    });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=600');
    return res.status(200).json({ ok: false, reason: `예측 데이터를 받지 못했어요: ${e.message}` });
  }
}
