# 경주 한산길

시간대별로 경주에서 붐비는 곳을 보여주고, 그곳을 피해서 가는 길(걸어서·버스·차)을 찾아주는 웹사이트.

## 폴더 구조

| 위치 | 내용 | 자주 고치는 곳 |
|---|---|---|
| `data/zones.js` | 혼잡 구역(위치·반경·평소 혼잡도) | ✅ 감으로 넣은 혼잡도 수정 |
| `data/attractions.js` | 주요 관광지(체류시간·꼭 볼 것·링크) | ✅ 현지인 팁 추가 |
| `data/closures.js` | 마라톤·대회 도로 통제 일정 | ✅ 일정 생길 때마다 추가 |
| `data/seasonality.js` | 월별 계절 배율 (데이터랩 CSV) | 새 CSV 받을 때 |
| `data/holidays.js` | 공휴일 | 1년에 한 번 |
| `lib/` | 혼잡도 계산·거리 계산·날짜 | 거의 안 고침 |
| `api/` | 서버 함수 (키는 여기서만 씀) | 거의 안 고침 |
| `index.html`, `style.css`, `app.js` | 화면 | 디자인 바꿀 때 |

## 필요한 키 (Vercel → Settings → Environment Variables)

| 이름 | 어디서 | 없으면 |
|---|---|---|
| `KAKAO_JS_KEY` | 카카오 개발자 콘솔 → 앱 → 플랫폼 키 → JavaScript 키 | 지도가 안 나옴 |
| `KAKAO_REST_KEY` | 카카오 개발자 콘솔 → 앱 → 플랫폼 키 → REST API 키 | 버스 경로 안 됨 |
| `GRAPHHOPPER_API_KEY` | GraphHopper 대시보드 → API Keys | 걸어서·차 경로 안 됨 |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 → 일반 인증키(Decoding) | 예측 없이 평소 패턴으로 계산 |

카카오 콘솔의 **JavaScript SDK 도메인**에 Vercel 주소(예: `https://gyeongju-hansangil.vercel.app`)를 꼭 추가하세요.

## 혼잡도 계산

```
점수 = 평소 혼잡도(구역·요일·시간대) × 계절 배율(월) × 그날 예측 배율
```

- 0~39 한산 / 40~64 보통 / 65~84 혼잡 / 85~ 매우 혼잡
- 걸어서·차: 보통 이상인 구역은 피하고, 붐빌수록 더 강하게 피해요. 차는 통제 구간을 거의 지나가지 않아요.
- 버스: 카카오가 준 소요시간에, 혼잡 구역을 지나가면 지연 예상(보통 +2분, 혼잡 +5분, 매우 혼잡 +10분, 통제 +15분)을 더해 추천 순서를 정해요 (`lib/transit.js`).

## 내 컴퓨터에서 미리 보기 (선택)

Node.js가 설치돼 있으면 설치할 패키지 없이 바로 돼요.

```
cp .env.example .env.local   # 키 채우기
node dev-server.js           # → http://localhost:3000
```
