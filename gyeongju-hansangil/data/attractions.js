// 주요 관광지
// ─────────────────────────────────────────────────────────────
// position   : [위도, 경도]  ※ 대략 위치예요. 실제 입구 좌표로 고쳐 주세요.
// zone       : 속한 혼잡 구역 id (data/zones.js), 없으면 null
// stayMin    : 평균 체류시간(분) ※ 임시값, 직접 채워 주세요
// highlights : 꼭 볼 것 (현지인 팁으로 바꾸면 이 사이트만의 장점이 돼요)
// links      : 연결할 웹사이트
// forecast   : 관광지 집중률 예측 API의 관광지 이름에서 찾을 단어
//              (예측 결과에 나온 이름과 다르면 여기를 고치면 돼요)
// ─────────────────────────────────────────────────────────────

const kakaoSearch = (q) => `https://map.kakao.com/link/search/${encodeURIComponent(q)}`;

export const ATTRACTIONS = [
  {
    id: 'hwangnidangil',
    name: '황리단길',
    position: [35.8372, 129.2095],
    zone: 'hwangnidan',
    stayMin: 90,
    highlights: ['한옥 지붕을 살린 카페·식당·소품숍 골목', '대릉원 돌담길과 바로 이어져요'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 황리단길') }],
    forecast: ['황리단'],
  },
  {
    id: 'daereungwon',
    name: '대릉원·천마총',
    position: [35.8381, 129.2125],
    zone: 'hwangnidan',
    stayMin: 60,
    highlights: ['천마총 내부 관람', '봄에는 고분 사이 목련 포토 스팟'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 대릉원') }],
    forecast: ['대릉원', '천마총'],
  },
  {
    id: 'cheomseongdae',
    name: '첨성대',
    position: [35.8347, 129.2190],
    zone: 'gyochon',
    stayMin: 20,
    highlights: ['해 진 뒤 조명', '주변 동부사적지 꽃단지 (계절마다 바뀜)'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 첨성대') }],
    forecast: ['첨성대', '동부사적'],
  },
  {
    id: 'gyochon',
    name: '교촌마을',
    position: [35.8296, 129.2155],
    zone: 'gyochon',
    stayMin: 40,
    highlights: ['경주 최부자댁', '경주향교'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 교촌마을') }],
    forecast: ['교촌'],
  },
  {
    id: 'woljeonggyo',
    name: '월정교',
    position: [35.8291, 129.2147],
    zone: 'gyochon',
    stayMin: 30,
    highlights: ['밤에 불 켜진 누각 다리'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 월정교') }],
    forecast: ['월정교'],
  },
  {
    id: 'donggung',
    name: '동궁과월지',
    position: [35.8348, 129.2266],
    zone: 'donggung',
    stayMin: 60,
    highlights: ['해 진 뒤 연못에 비친 야경'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 동궁과월지') }],
    forecast: ['동궁', '월지', '안압지'],
  },
  {
    id: 'museum',
    name: '국립경주박물관',
    position: [35.8296, 129.2278],
    zone: 'donggung',
    stayMin: 90,
    highlights: ['성덕대왕신종', '신라 금관'],
    links: [
      { label: '공식 홈페이지', url: 'https://gyeongju.museum.go.kr' },
      { label: '카카오맵에서 보기', url: kakaoSearch('국립경주박물관') },
    ],
    forecast: ['경주박물관'],
  },
  {
    id: 'gyeongjuworld',
    name: '경주월드',
    position: [35.8366, 129.2833],
    zone: 'bomun',
    stayMin: 300,
    highlights: ['놀이기구는 주말 대기가 길어요'],
    links: [
      { label: '공식 홈페이지', url: 'https://www.gjw.co.kr' },
      { label: '카카오맵에서 보기', url: kakaoSearch('경주월드') },
    ],
    forecast: ['경주월드'],
  },
  {
    id: 'bomunlake',
    name: '보문호반길',
    position: [35.8445, 129.2870],
    zone: 'bomun',
    stayMin: 60,
    highlights: ['호수 둘레 산책로', '봄 벚꽃'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('보문호반길') }],
    forecast: ['보문'],
  },
  {
    id: 'bulguksa',
    name: '불국사',
    position: [35.7898, 129.3320],
    zone: 'bulguksa',
    stayMin: 90,
    highlights: ['다보탑·석가탑', '청운교·백운교'],
    links: [
      { label: '공식 홈페이지', url: 'http://www.bulguksa.or.kr' },
      { label: '카카오맵에서 보기', url: kakaoSearch('경주 불국사') },
    ],
    forecast: ['불국사'],
  },
  {
    id: 'seokguram',
    name: '석굴암',
    position: [35.7950, 129.3492],
    zone: null,
    stayMin: 40,
    highlights: ['본존불'],
    links: [{ label: '카카오맵에서 보기', url: kakaoSearch('경주 석굴암') }],
    forecast: ['석굴암'],
  },
];
