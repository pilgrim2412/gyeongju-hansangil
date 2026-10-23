// 혼잡 구역 목록
// ─────────────────────────────────────────────────────────────
// 여기 값만 고치면 지도·시간표·경로 회피가 전부 같이 바뀌어요.
//
// short   : 시간표에 쓸 짧은 이름
// center  : [위도, 경도]  (카카오맵에서 지점 우클릭 → 좌표 확인 가능)
// radiusM : 구역 반경(미터)
// season  : 계절 배율에 쓸 데이터 이름 (data/seasonality.js 참고)
// pattern : 평소 혼잡도 (1 = 낮음, 2 = 보통, 3 = 높음)
//           오전 06~11시 / 오후 12~17시 / 저녁 18~22시
//           ※ 지금 값은 임시예요. 경주 사람 감으로 고쳐 주세요!
// ─────────────────────────────────────────────────────────────

export const ZONES = [
  {
    id: 'hwangnidan',
    name: '황리단길·대릉원',
    short: '황리단길',
    center: [35.8366, 129.2104],
    radiusM: 430,
    season: '황리단길권역',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 2 },
      weekend: { morning: 2, afternoon: 3, evening: 3 },
    },
  },
  {
    id: 'gyochon',
    name: '첨성대·교촌·월정교',
    short: '첨성대·교촌',
    center: [35.8318, 129.2172],
    radiusM: 420,
    season: '교촌한옥마을',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 2 },
    },
  },
  {
    id: 'donggung',
    name: '동궁과월지·박물관',
    short: '동궁과월지',
    center: [35.8325, 129.2270],
    radiusM: 360,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 1, evening: 2 },
      weekend: { morning: 1, afternoon: 2, evening: 3 },
    },
  },
  {
    id: 'bomun',
    name: '보문관광단지·경주월드',
    short: '보문·경주월드',
    center: [35.8410, 129.2845],
    radiusM: 1100,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 2 },
    },
  },
  {
    id: 'bulguksa',
    name: '불국사',
    short: '불국사',
    center: [35.7900, 129.3320],
    radiusM: 450,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 1 },
    },
  },
];
