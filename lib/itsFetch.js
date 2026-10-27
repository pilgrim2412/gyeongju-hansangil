// ITS 오픈API 부르기 (서버 전용: api/events.js, api/speeds.js)
// ─────────────────────────────────────────────────────────────
// 키는 Vercel 환경변수 ITS_API_KEY 에만 있어요. 응답·오류 문구에 키가 섞이지 않게 해요.
// ITS는 해외 회사 서버(아마존 등)의 접속을 막아요. Vercel도 아마존 위에서 돌아서 직접은 안 되고,
// ITS_RELAY_URL 이 있으면 네이버 클라우드 중계 함수(relay/ncp-its-relay.cjs)를 거쳐서 불러요.
// 월 호출 한도가 서비스마다 3,000건이라, 받은 결과를 잠깐 기억해 두고 다시 써요.
// ─────────────────────────────────────────────────────────────

import tls from 'node:tls';
import dns from 'node:dns/promises';
import { GYEONGJU_BBOX, itsItems, itsError } from './its.js';

const HOST = 'openapi.its.go.kr';
const PORT = 9443;
const BASE = `https://${HOST}:${PORT}`;
const TIMEOUT_MS = 25000; // ITS가 느릴 때가 있어서 넉넉하게 (vercel.json maxDuration 30초)
const memo = new Map(); // 서비스 이름 → { at, result }
let downUntil = 0; // 연결이 안 되면 30분 동안은 다시 시도하지 않고 바로 실패로 (페이지가 기다리지 않게)
const DOWN_MS = 30 * 60 * 1000;

// 중계 함수 결과 꺼내기 (API Gateway가 한 번 더 감싸서 줄 수도 있어서)
function unwrap(obj) {
  for (let o = obj, i = 0; o && typeof o === 'object' && i < 4; i++) {
    if ('ok' in o && ('text' in o || 'error' in o || 'connect' in o)) return o;
    o = o.result ?? o.response?.result ?? o.body ?? o.response;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  }
  return null;
}

async function callRelay(service, query, timeoutMs) {
  const url = new URL(process.env.ITS_RELAY_URL);
  url.searchParams.set('service', service);
  url.searchParams.set('t', process.env.ITS_RELAY_TOKEN || '');
  if (query) url.searchParams.set('q', query);
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const raw = await r.text();
  let obj = null;
  try { obj = unwrap(JSON.parse(raw)); } catch { /* 아래에서 처리 */ }
  if (!obj) throw Object.assign(new Error(`중계 응답을 읽지 못했어요 (HTTP ${r.status}) ${raw.slice(0, 120)}`), { relay: true });
  return obj;
}

// XML로 올 때 대비: <data>…</data> 또는 <item>…</item> 안의 <이름>값</이름> 꺼내기
function xmlItems(text) {
  const blocks = text.match(/<(data|item)>[\s\S]*?<\/\1>/g) || [];
  return blocks.map((b) => {
    const row = {};
    for (const m of b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) row[m[1]] = m[2].trim();
    return row;
  });
}

export async function fetchIts(service, params = {}, keepMs = 10 * 60 * 1000, { fresh = false } = {}) {
  const key = process.env.ITS_API_KEY;
  if (!key) return { ok: false, reason: 'ITS_API_KEY가 설정되지 않았어요.' };
  const hit = memo.get(service);
  if (!fresh && hit && Date.now() - hit.at < keepMs) return hit.result;
  if (!fresh && Date.now() < downUntil) return { ok: false, down: true, reason: 'ITS 서버에 연결이 안 돼서 잠시 쉬는 중이에요.' };
  const t0 = Date.now();

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
    let r;
    let text;
    if (process.env.ITS_RELAY_URL) {
      const o = await callRelay(service, qs.toString(), TIMEOUT_MS + 3000);
      if (!o.ok) {
        if (/ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|timeout/i.test(`${o.code} ${o.error}`)) {
          throw Object.assign(new Error(o.error), { cause: { code: o.code || 'ETIMEDOUT' }, viaRelay: true });
        }
        return { ok: false, reason: hide(`중계 함수 오류: ${o.error || '알 수 없음'}`) };
      }
      r = { status: o.status };
      text = o.text || '';
    } else {
      r = await fetch(`${BASE}/${service}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await r.text();
    }
    const ms = Date.now() - t0;
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
    const result = { ok: true, items, ms, bytes: text.length };
    memo.set(service, { at: Date.now(), result });
    return result;
  } catch (e) {
    const ms = Date.now() - t0;
    const code = e?.cause?.code || '';
    if (e?.name === 'TimeoutError' || /CONNECT_TIMEOUT|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(code)) {
      downUntil = Date.now() + DOWN_MS;
      return { ok: false, down: true, ms, reason: `ITS 서버에 연결이 안 돼요 (${code || '응답 없음'}${e.viaRelay ? ', 중계 함수에서도' : ''}). 클라우드 서버 접속을 막는 것 같아요.` };
    }
    if (e?.name === 'TimeoutError') {
      return { ok: false, ms, reason: `ITS 서버가 ${Math.round(ms / 1000)}초 동안 응답하지 않았어요.` };
    }
    return { ok: false, ms, reason: hide(`ITS에 연결하지 못했어요: ${e?.cause?.code || e?.message || e}`) };
  }
}

// 한국 시간 'YYYY-MM-DDTHH:MM'
export const kstStamp = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16);

// 연결 점검 (?debug=1): 서버가 어느 지역에서 도는지, ITS 서버까지 연결(TLS)이 되는지 따로 확인
export async function diagnose() {
  const out = { region: process.env.VERCEL_REGION || 'unknown' };
  if (process.env.ITS_RELAY_URL) {
    try {
      out.relay = await callRelay('ping', '', 20000);
    } catch (e) {
      out.relay = { ok: false, error: e.message };
    }
    return out;
  }
  try {
    out.dns = (await dns.lookup(HOST, { all: true })).map((a) => a.address);
  } catch (e) {
    out.dns = `실패: ${e.code || e.message}`;
  }
  out.connect = await new Promise((resolve) => {
    const t0 = Date.now();
    const sock = tls.connect({ host: HOST, port: PORT, servername: HOST, timeout: 10000 });
    const done = (v) => { sock.destroy(); resolve({ ...v, ms: Date.now() - t0 }); };
    sock.once('secureConnect', () => done({ ok: true }));
    sock.once('timeout', () => done({ ok: false, error: '10초 동안 연결 안 됨 (막혀 있을 가능성)' }));
    sock.once('error', (e) => done({ ok: false, error: e.code || e.message }));
  });
  return out;
}
