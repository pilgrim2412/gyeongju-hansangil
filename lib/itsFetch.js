// ITS 오픈API 부르기 (서버 전용: api/events.js, api/speeds.js)
// ─────────────────────────────────────────────────────────────
// 키는 Vercel 환경변수 ITS_API_KEY 에만 있어요. 응답·오류 문구에 키가 섞이지 않게 해요.
// ITS는 국내 IP에서만 답해서, 서버 함수를 서울(icn1)에서 돌려요 (vercel.json).
// 월 호출 한도가 서비스마다 3,000건이라, 받은 결과를 잠깐 기억해 두고 다시 써요.
// ─────────────────────────────────────────────────────────────

import { GYEONGJU_BBOX, itsItems, itsError } from './its.js';

const BASE = 'https://openapi.its.go.kr:9443';
const memo = new Map(); // 서비스 이름 → { at, result }

// XML로 올 때 대비: <data>…</data> 또는 <item>…</item> 안의 <이름>값</이름> 꺼내기
function xmlItems(text) {
  const blocks = text.match(/<(data|item)>[\s\S]*?<\/\1>/g) || [];
  return blocks.map((b) => {
    const row = {};
    for (const m of b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) row[m[1]] = m[2].trim();
    return row;
  });
}

export async function fetchIts(service, params = {}, keepMs = 10 * 60 * 1000) {
  const key = process.env.ITS_API_KEY;
  if (!key) return { ok: false, reason: 'ITS_API_KEY가 설정되지 않았어요.' };
  const hit = memo.get(service);
  if (hit && Date.now() - hit.at < keepMs) return hit.result;

  const hide = (msg) => String(msg).split(key).join('***');
  const qs = new URLSearchParams({
    apiKey: key,
    type: 'all',
    getType: 'json',
    minX: String(GYEONGJU_BBOX.minX),
    maxX: String(GYEONGJU_BBOX.maxX),
    minY: String(GYEONGJU_BBOX.minY),
    maxY: String(GYEONGJU_BBOX.maxY),
    ...params,
  });
  try {
    const r = await fetch(`${BASE}/${service}?${qs}`, { signal: AbortSignal.timeout(9000) });
    const text = await r.text();
    let items;
    if (text.trim().startsWith('<')) {
      items = xmlItems(text);
      const code = text.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1];
      if (!items.length && code && !['0', '00'].includes(code)) {
        return { ok: false, reason: hide(`ITS 오류 ${code} ${text.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1] || ''}`) };
      }
    } else {
      let payload;
      try { payload = JSON.parse(text); } catch {
        return { ok: false, reason: `ITS 응답을 읽지 못했어요 (HTTP ${r.status})` };
      }
      const err = itsError(payload);
      if (err) return { ok: false, reason: hide(`ITS 오류 ${err}`) };
      items = itsItems(payload);
    }
    const result = { ok: true, items };
    memo.set(service, { at: Date.now(), result });
    return result;
  } catch (e) {
    if (e?.name === 'TimeoutError') {
      return { ok: false, reason: 'ITS 서버가 응답하지 않아요. 서버 지역이 서울(icn1)인지 확인해 주세요.' };
    }
    return { ok: false, reason: hide(`ITS에 연결하지 못했어요: ${e?.cause?.code || e?.message || e}`) };
  }
}

// 한국 시간 'YYYY-MM-DDTHH:MM'
export const kstStamp = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16);
