// 네이버 클라우드 Cloud Functions용 ITS 중계 함수
// ─────────────────────────────────────────────────────────────
// ITS(국가교통정보센터)는 해외 회사 서버(아마존·구글 등)의 접속을 막아서,
// Vercel → 이 함수(네이버 클라우드, 한국 IP) → ITS 순서로 대신 불러줘요.
//
// 네이버 클라우드 콘솔 → Cloud Functions → Action 만들기에서
//   - 런타임: Node.js (가장 높은 버전)
//   - 이 파일 내용을 그대로 붙여넣기
//   - 디폴트 파라미터: {"token": "아무도 모르는 긴 문자열"}  ← Vercel의 ITS_RELAY_TOKEN 과 같게
// 이 파일은 Vercel에서 쓰지 않아요 (.vercelignore).
// ─────────────────────────────────────────────────────────────

const https = require('https');
const tls = require('tls');

const HOST = 'openapi.its.go.kr';
const PORT = 9443;
const SERVICES = ['trafficInfo', 'eventInfo', 'fcTraffic', 'cctvInfo'];

function get(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

// 연결 점검: 이 함수가 어떤 IP로 나가는지, ITS까지 연결이 되는지
async function ping() {
  const out = {};
  try {
    out.ip = JSON.parse((await get('https://api.ipify.org?format=json', 5000)).text).ip;
  } catch (e) {
    out.ip = `확인 실패: ${e.code || e.message}`;
  }
  out.connect = await new Promise((resolve) => {
    const t0 = Date.now();
    const s = tls.connect({ host: HOST, port: PORT, servername: HOST, timeout: 10000 });
    const done = (v) => { s.destroy(); resolve({ ...v, ms: Date.now() - t0 }); };
    s.once('secureConnect', () => done({ ok: true }));
    s.once('timeout', () => done({ ok: false, error: '10초 동안 연결 안 됨' }));
    s.once('error', (e) => done({ ok: false, error: e.code || e.message }));
  });
  return { ok: true, relay: 'ncp', ...out };
}

async function main(params) {
  if (!params.token || params.t !== params.token) return { ok: false, error: '토큰이 맞지 않아요.' };
  if (params.service === 'ping') return ping();
  if (!SERVICES.includes(params.service)) return { ok: false, error: '모르는 서비스예요.' };
  const t0 = Date.now();
  try {
    const r = await get(`https://${HOST}:${PORT}/${params.service}?${params.q || ''}`, 25000);
    return { ok: true, status: r.status, ms: Date.now() - t0, text: r.text };
  } catch (e) {
    return { ok: false, code: e.code || '', error: e.message, ms: Date.now() - t0 };
  }
}

exports.main = main;
