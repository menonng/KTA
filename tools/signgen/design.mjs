// Sign design generator: turns a sign request (kind, business category,
// size) into a concrete design spec. Deterministic per request seed.
//
// Names are fictional: generic Korean shop-name patterns (prefix + trade
// word) plus English words, never real small-business names. Real chains
// arrive here already renamed to their parody names (brand-bible.md).
// Phone numbers use 02-0xxx / 010-0xxx, which are never assigned in Korea.

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  f.chance = (p) => f() < p;
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  return f;
}

// ---------------------------------------------------------------- names
const P = [
  '행복', '미소', '우리', '한빛', '대박', '청춘', '홍대', '연남', '서교', '와우', '제일', '으뜸', '참', '명가', '원조', '옛날',
  '할매', '엄마손', '이모네', '삼촌네', '김씨네', '박가네', '왕', '큰손', '착한', '바른', '소문난', '달빛', '별빛', '노을', '하늘',
  '봄날', '오늘', '모퉁이', '골목', '언덕', '다락', '마당', '소담', '담소', '온', '쉼', '다온', '가온', '라온', '아라', '나래',
  '누리', '한울', '동네', '시골', '고향', '정', '복', '황금', '은하', '해뜨는', '꿀', '통큰', '고래', '토끼', '곰', '호랑이',
  '부엉이', '청년', '형제', '친구', '단골', '두꺼비', '까치', '제비', '산들', '푸른', '초록', '진국', '뚝배기', '가마솥', '장터',
];
const PM = ['모노', '오브', '라운지', '메종', '아뜰리에', '하우스', '어반', '데일리', '포레스트', '브릭', '노트', '쉘터', '오아시스', '플랫', '그로브', '루프'];
const PC = ['연세', '서울', '바른', '튼튼', '밝은', '맑은', '새봄', '하나', '미래', '온누리', '열린', '고운', '편한', '홍대', '서교', '마포', '신촌', '365', '우리들', '굿모닝', '푸른숲'];
const EN = [
  'MOMENT', 'HELLO', 'DAILY', 'MELLOW', 'SLOW', 'COZY', 'BLOOM', 'HAZE', 'SUNDAY', 'PLAIN', 'ORDINARY', 'WEEKEND', 'NOOK', 'LUMEN',
  'IVORY', 'OAT', 'FIG', 'MONO', 'ROUTINE', 'LAYER', 'BLANK', 'UNION', 'NORTH', 'PARK', 'RIVER', 'STONE', 'FOLK', 'TIDE', 'CLOUD',
  'MAPLE', 'OLIVE', 'HONEY', 'PEACH', 'LEMON', 'MINT', 'COCOA', 'BUTTER', 'VELVET', 'RETRO', 'NEON', 'PIXEL', 'ECHO', 'LOOP', 'VIBE',
  'FLOW', 'GROOVE', 'JAZZ', 'SOUL', 'INDIE', 'URBAN', 'METRO', 'COSMO', 'LUNA', 'STELLA', 'NOVA', 'ORBIT', 'ATLAS', 'HARBOR', 'CORNER',
  'ALLEY', 'ROOF', 'ATTIC', 'GARDEN', 'YARD', 'LUCKY', 'HAPPY', 'STAR', 'MOON', 'SKY', 'BLUE', 'RED', 'GOLD', 'SILVER', 'ZERO', 'ONE',
];
const ENC = (s) => s[0] + s.slice(1).toLowerCase();

// category -> name templates, icon emoji, vibe, menu/sub lines
const CAT = {
  restaurant: { n: ['{p}식당', '{p}밥상', '{p}집밥', '{p}부대찌개', '{p}닭갈비', '{p}쭈꾸미', '{p}김치찜', '{p}제육', '{p}돈까스', '{p}수제비', '{p}칼국수', '{p}냉면', '{p}보쌈', '{p}족발', '{p}닭한마리', '{p}마라탕', '{p}쌀국수', '{p}카레', '{p}덮밥', '{p}감자탕', '{p}생선구이', '{p}순두부'], i: ['🍲', '🍜', '🍚', '🥘', '🍛'], v: 'trad', m: ['점심특선 · 저녁 · 포장', '단체석 완비', '24시 영업', '포장 · 배달', '정성을 다하는 집'] },
  snack: { n: ['{p}분식', '{p}김밥', '{p}떡볶이', '{p}튀김', '김밥{p}', '{p}라볶이'], i: ['🍢', '🍙', '🥟'], v: 'trad', m: ['떡볶이 · 순대 · 튀김 · 김밥', '포장 전문', '라면 · 김밥 · 돈까스'] },
  tteokbokki: { n: ['{p}떡볶이', '{p}즉석떡볶이', '{p}국물떡볶이'], i: ['🌶️', '🍢'], v: 'trad', m: ['매운맛 · 순한맛 · 치즈', '즉석 떡볶이 전문'] },
  korean: { n: ['{p}국밥', '{p}순대국', '{p}해장국', '{p}설렁탕', '{p}곰탕', '{p}한정식'], i: ['🍲', '🥣'], v: 'trad', m: ['순대국 · 수육 · 머릿고기', '24시 영업', '가마솥 사골육수'] },
  baekban: { n: ['{p}백반', '{p}기사식당', '{p}밥집', '{p}가정식'], i: ['🍚', '🥢'], v: 'trad', m: ['오늘의 백반 · 제육 · 찌개', '한식 뷔페'] },
  gukbap: { n: ['{p}국밥', '{p}돼지국밥', '{p}뼈해장국'], i: ['🍲'], v: 'trad', m: ['국밥 · 수육 · 소주', '24시'] },
  chicken: { n: ['{p}치킨', '{p}통닭', '{p}닭강정', '치킨{p}', '옛날통닭'], i: ['🍗', '🐔'], v: 'trad', m: ['후라이드 · 양념 · 간장 · 파닭', '배달 · 포장', '치킨 & 호프'] },
  japanese: { n: ['{p}스시', '{p}돈까스', '{p}우동', '{p}텐동', '{p}규동'], i: ['🍣', '🍤', '🍱'], v: 'modern', m: ['돈까스 · 우동 · 소바', '런치 세트'] },
  ramen: { n: ['{p}라멘', '{p}멘야', '{p}돈코츠', '라멘 {p}'], i: ['🍜'], v: 'modern', m: ['돈코츠 · 쇼유 · 미소', '진한 국물 라멘'] },
  izakaya: { n: ['이자카야 {p}', '{p}이자카야', '{p}사케', '{p}야키토리'], i: ['🍶', '🏮'], v: 'night', m: ['꼬치 · 사케 · 하이볼', '이자카야'] },
  chinese: { n: ['{p}반점', '{p}각', '{p}루', '{p}성', '{p}마라탕', '{p}훠궈', '{p}양꼬치'], i: ['🥟', '🥢', '🌶️'], v: 'trad', m: ['짜장 · 짬뽕 · 탕수육', '중화요리', '마라탕 · 마라샹궈 · 꿔바로우'] },
  pizza: { n: ['{e} PIZZA', '{p}피자', '{e} 피자'], i: ['🍕'], v: 'modern', m: ['화덕피자 · 파스타', 'PIZZA & BEER'] },
  burger: { n: ['{e} BURGER', '{p}버거', '수제버거 {p}', '{e} 버거'], i: ['🍔'], v: 'modern', m: ['수제버거 · 감자튀김', 'BURGER & BEER'] },
  western: { n: ['{e} BISTRO', '{p}파스타', '{e} KITCHEN', '{p}스테이크', '{e} 다이닝'], i: ['🍝', '🍷'], v: 'modern', m: ['PASTA · STEAK · WINE', '브런치'] },
  bbq: { n: ['{p}삼겹살', '{p}갈비', '{p}숯불갈비', '{p}고깃집', '{p}목살', '생고기{p}', '{p}막창', '{p}곱창', '{p}양꼬치', '{p}숯불구이'], i: ['🥩', '🐷', '🔥'], v: 'trad', m: ['삼겹살 · 목살 · 항정살 · 갈매기살', '국내산 생고기', '숯불 직화구이'] },
  cafe: { n: ['{e} COFFEE', '카페 {p}', '{e} CAFE', '{p}커피', '{E} coffee roasters', '{e} 커피', '카페{m}', '{E} Coffee'], i: ['☕'], v: 'modern', m: ['COFFEE · TEA · DESSERT', 'specialty coffee', '핸드드립 · 디저트'] },
  dessert: { n: ['{e} DESSERT', '{p}케이크', '{e} BAKE', '{p}빙수', '{p}마카롱', '{p}와플', '{E} sweets'], i: ['🍰', '🧁', '🍧'], v: 'modern', m: ['케이크 · 마카롱 · 빙수', 'DESSERT CAFE'] },
  bakery: { n: ['{p}베이커리', '{p}제과', '{e} BAKERY', '{p}빵집', '{E} Bakery'], i: ['🍞', '🥐'], v: 'modern', m: ['매일 아침 굽는 빵', 'BREAD · CAKE · COFFEE'] },
  icecream: { n: ['{e} GELATO', '{p}아이스크림', '{E} gelato'], i: ['🍦'], v: 'modern', m: ['젤라또 · 소프트아이스크림'] },
  hof: { n: ['{p}호프', '{p}비어', '{e} PUB', '{p}생맥주', '호프{p}', '{p}맥주'], i: ['🍺'], v: 'night', m: ['생맥주 · 치킨 · 노가리', '시원한 생맥주'] },
  pocha: { n: ['{p}포차', '{p}포장마차', '실내포차 {p}', '{p}주막', '{p}술집', '{p}이자카야'], i: ['🍶', '🏮'], v: 'night', m: ['닭발 · 오돌뼈 · 계란말이', '안주 · 소주 · 맥주'] },
  bar: { n: ['{e} BAR', 'BAR {e}', '{e} LOUNGE', '{e} PUB', '{p}와인바', 'LP BAR {e}', '{E} bar'], i: ['🍸', '🍷'], v: 'night', m: ['COCKTAIL · WHISKEY · WINE', 'LIVE MUSIC'] },
  club: { n: ['CLUB {e}', '{e} CLUB', '{e}'], i: ['🎧'], v: 'night', m: ['EVERY FRI & SAT', 'HIPHOP · EDM · HOUSE'] },
  karaoke: { n: ['{p}노래연습장', '{p}노래방', '{e} 노래방', '노래연습장 {p}'], i: ['🎤'], v: 'night', m: ['최신곡 · 단체룸 · 쾌적한 시설', '노래연습장'] },
  coinkaraoke: { n: ['{p}코인노래방', '코인노래연습장 {p}', '{e} 코인노래방'], i: ['🎤'], v: 'night', m: ['1곡 500원 · 24시', '무인 코인노래방'] },
  pc: { n: ['{e} PC방', '{p}PC방', '{e} PC CAFE', '{e} PC'], i: ['🖥️', '🎮'], v: 'night', m: ['최신사양 · 고급의자 · 24시', 'PC CAFE'] },
  billiards: { n: ['{p}당구장', '{p}당구클럽', '{e} 당구장'], i: ['🎱'], v: 'night', m: ['포켓볼 · 3쿠션 · 4구', '당구클럽'] },
  arcade: { n: ['{p}오락실', '{e} 게임랜드', '인형뽑기 {p}', '{e} ARCADE'], i: ['🕹️', '🎮'], v: 'night', m: ['인형뽑기 · 리듬게임 · 펌프', '게임센터'] },
  roomcafe: { n: ['{p}룸카페', '{e} 룸카페', '{p}멀티카페'], i: ['🛋️'], v: 'night', m: ['보드게임 · 영화 · 음료 무한리필'] },
  manga: { n: ['{p}만화카페', '{e} 만화카페', '만화방 {p}'], i: ['📚'], v: 'night', m: ['만화 · 라면 · 음료'] },
  boardgame: { n: ['보드게임카페 {e}', '{p}보드게임', '{e} 보드게임'], i: ['🎲'], v: 'night', m: ['보드게임 300여종'] },
  escape: { n: ['{e} 방탈출', '방탈출카페 {p}', '{e} ESCAPE'], i: ['🔑', '🚪'], v: 'night', m: ['테마 6종 · 예약제'] },
  hair: { n: ['{p}헤어', '헤어{p}', '{e} HAIR', '{p}미용실', '{E} hair salon', '헤어살롱 {p}', '{p}헤어샵'], i: ['✂️', '💇'], v: 'modern', m: ['CUT · PERM · COLOR', '커트 · 펌 · 염색 · 클리닉'] },
  nail: { n: ['{e} NAIL', '{p}네일', '{e} 네일&속눈썹', '{p}뷰티', '{E} nail'], i: ['💅'], v: 'modern', m: ['젤네일 · 속눈썹 · 왁싱'] },
  cosmetics: { n: ['{e} BEAUTY', '{p}화장품', '{e} COSMETICS'], i: ['💄'], v: 'modern', m: ['스킨케어 · 메이크업'] },
  clinic: { n: ['{c}내과의원', '{c}이비인후과', '{c}피부과의원', '{c}정형외과', '{c}한의원', '{c}소아청소년과', '{c}안과의원', '{c}가정의학과', '{c}재활의학과'], i: ['🩺'], v: 'pro', m: ['감기 · 독감예방접종 · 건강검진', '진료시간 09:00 - 19:00', '전문의 진료'] },
  dentist: { n: ['{c}치과의원', '{c}치과', '{c}플란트치과'], i: ['🦷'], v: 'pro', m: ['임플란트 · 교정 · 충치치료', '야간진료'] },
  pharmacy: { n: ['{c}약국'], i: ['💊'], v: 'pro', m: ['처방조제 · 일반의약품'] },
  realestate: { n: ['{c}공인중개사사무소', '{c}부동산', '{c}공인중개사'], i: ['🏠'], v: 'pro', m: ['매매 · 전세 · 월세 · 상가', '원룸 · 투룸 · 사무실'] },
  academy: { n: ['{c}수학학원', '{c}영어학원', '{c}입시학원', '{c}국어논술', '{c}미술학원', '{c}코딩학원', '{e} 어학원'], i: ['✏️', '📖'], v: 'pro', m: ['초 · 중 · 고 · 내신 · 수능', '소수정예 · 1:1 관리'] },
  music_academy: { n: ['{c}실용음악학원', '{e} 실용음악', '{c}보컬학원', '{c}드럼학원', '{e} 댄스학원', '{c}댄스아카데미'], i: ['🎸', '🎵', '🥁'], v: 'pro', m: ['보컬 · 기타 · 드럼 · 작곡', '입시 · 취미 · 오디션'] },
  pilates: { n: ['{c}필라테스', '{e} PILATES', '{c}요가', '{e} FITNESS', '{c}휘트니스', '{e} GYM'], i: ['🧘', '💪'], v: 'pro', m: ['1:1 PT · 그룹레슨', 'GX · PT · 필라테스'] },
  studio: { n: ['{e} STUDIO', '{p}스튜디오', '{e} 녹음실', '셀프사진관 {e}', '{e} 연습실'], i: ['📷', '🎙️'], v: 'modern', m: ['합주실 · 녹음 · 연습실', '셀프 사진관'] },
  guesthouse: { n: ['{e} GUESTHOUSE', '{e} HOSTEL', '{p}게스트하우스'], i: ['🛏️'], v: 'modern', m: ['도미토리 · 개인실'] },
  hotel: { n: ['HOTEL {e}', '{e} HOTEL', '{p}호텔'], i: ['🛎️'], v: 'modern', m: ['대실 · 숙박'] },
  clothes: { n: ['{e}', '{e} STORE', '{e} SHOP', '{e} SELECT', '{E}'], i: ['👕', '👗'], v: 'modern', m: ['NEW ARRIVAL', 'MEN · WOMEN'] },
  vintage: { n: ['{e} VINTAGE', '구제 {p}', '{e} 빈티지', '{p}구제'], i: ['👖'], v: 'modern', m: ['VINTAGE · USED', '구제 의류'] },
  shoes: { n: ['{e} SHOES', '{p}신발', '{e} SNEAKERS'], i: ['👟'], v: 'modern', m: ['운동화 · 구두'] },
  mart: { n: ['{p}마트', '{p}슈퍼', '{p}식자재마트', '{p}슈퍼마켓'], i: ['🛒'], v: 'pro', m: ['신선식품 · 생활용품 · 배달', '연중무휴'] },
  gift: { n: ['{e} 소품샵', '{e} SHOP', '{e} 굿즈샵', '{p}잡화'], i: ['🎁'], v: 'modern', m: ['소품 · 문구 · 선물'] },
  stationery: { n: ['{p}문구', '{p}문방구', '{p}팬시'], i: ['✏️'], v: 'pro', m: ['문구 · 팬시 · 복사'] },
  books: { n: ['{p}서점', '{e} BOOKS', '{p}책방'], i: ['📚'], v: 'modern', m: ['독립출판 · 중고책'] },
  music: { n: ['{p}악기', '{e} GUITAR', '{p}음악사'], i: ['🎸'], v: 'pro', m: ['기타 · 앰프 · 수리'] },
  liquor: { n: ['{p}주류', '{e} WINE', '{p}와인샵'], i: ['🍷'], v: 'modern', m: ['와인 · 위스키 · 전통주'] },
  photo: { n: ['{p}사진관', '{e} PHOTO'], i: ['📷'], v: 'modern', m: ['증명사진 · 여권사진'] },
  tattoo: { n: ['{e} TATTOO', '{e} INK'], i: ['🖋️'], v: 'modern', m: ['TATTOO & PIERCING'] },
  massage: { n: ['{p}마사지', '{e} 타이마사지', '{p}발마사지'], i: ['💆'], v: 'pro', m: ['타이 · 스포츠 · 아로마'] },
  laundry: { n: ['{p}세탁', '{p}세탁소', '{p}코인빨래방', '{e} 코인세탁'], i: ['🧺', '👔'], v: 'pro', m: ['드라이클리닝 · 수선', '24시 무인 빨래방'] },
  optician: { n: ['{c}안경', '{e} 안경원', '{c}안경점'], i: ['👓'], v: 'pro', m: ['안경 · 콘택트렌즈 · 선글라스'] },
  phone: { n: ['{p}폰', '{p}휴대폰', '{e} 모바일'], i: ['📱'], v: 'pro', m: ['최신폰 · 공짜폰 · 번호이동'] },
  church: { n: ['{c}교회'], i: ['⛪'], v: 'pro', m: ['주일예배 11:00'] },
  bank: { n: ['{c}은행'], i: ['🏦'], v: 'pro', m: ['ATM 24시'] },
  rent: { n: ['임대'], i: [], v: 'pro', m: [] },
};

// Short trade words for projecting and tenant-directory signs.
const SHORT = {
  restaurant: ['식당', '맛집', '한식', '밥집', '기사식당'], snack: ['분식', '김밥', '떡볶이'], tteokbokki: ['떡볶이'], korean: ['국밥', '해장국', '한식'],
  baekban: ['백반', '한식'], gukbap: ['국밥'], chicken: ['치킨', '통닭'], japanese: ['돈까스', '일식', '우동'], ramen: ['라멘'], izakaya: ['이자카야', '사케'],
  chinese: ['중화요리', '반점', '마라탕'], pizza: ['PIZZA', '피자'], burger: ['BURGER', '버거'], western: ['파스타', 'BISTRO'], bbq: ['고기', '삼겹살', '갈비', '곱창'],
  cafe: ['CAFE', 'COFFEE', '카페', '커피'], dessert: ['디저트', 'CAKE', '빙수'], bakery: ['베이커리', '빵', 'BAKERY'], icecream: ['GELATO', '아이스크림'],
  hof: ['호프', '생맥주', 'BEER', 'HOF'], pocha: ['포차', '포장마차', '실내포차', '주점'], bar: ['BAR', 'PUB', '칵테일', 'LOUNGE'], club: ['CLUB'],
  karaoke: ['노래방', '노래연습장'], coinkaraoke: ['코인노래방', '코인노래'], pc: ['PC방', 'PC', 'PC CAFE'], billiards: ['당구장', '당구클럽', '당구'],
  arcade: ['오락실', '게임장', '인형뽑기'], roomcafe: ['룸카페', '멀티방'], manga: ['만화카페', '만화방'], boardgame: ['보드게임', '보드카페'], escape: ['방탈출'],
  hair: ['헤어', '미용실', 'HAIR', '헤어샵'], nail: ['NAIL', '네일', '네일샵'], cosmetics: ['화장품', 'BEAUTY'],
  clinic: ['내과', '의원', '피부과', '한의원', '정형외과', '이비인후과'], dentist: ['치과'], pharmacy: ['약국'], realestate: ['부동산', '공인중개사'],
  academy: ['학원', '수학', '영어', '입시', '미술학원'], music_academy: ['실용음악', '보컬', '드럼', '댄스'], pilates: ['필라테스', '요가', 'GYM', '헬스'],
  studio: ['STUDIO', '스튜디오', '연습실', '녹음실'], guesthouse: ['HOSTEL', '게스트하우스'], hotel: ['HOTEL', '호텔', '모텔'], clothes: ['SHOP', '의류', 'STORE'],
  vintage: ['구제', 'VINTAGE'], shoes: ['신발', 'SHOES'], mart: ['마트', '슈퍼'], gift: ['소품', '선물', '팬시'], stationery: ['문구'], books: ['서점', '책방', 'BOOKS'],
  music: ['악기'], liquor: ['와인', '주류'], photo: ['사진관'], tattoo: ['TATTOO'], massage: ['마사지'], laundry: ['세탁', '빨래방'], optician: ['안경'],
  phone: ['휴대폰', '폰'], church: ['교회'], bank: ['은행'],
};

export function shortName(cat, r) {
  const w = r.pick(SHORT[cat] || SHORT.restaurant);
  if (!isLatin(w) && r.chance(0.55)) {
    const pro = (CAT[cat] || {}).v === 'pro';
    const p = r.pick(pro ? PC : P);
    if ([...(p + w)].length <= 6) return p + w;
  }
  return w;
}

export function phone(r) {
  const d = (n) => Array.from({ length: n }, () => r.int(0, 9)).join('');
  return r.chance(0.6) ? `02-0${d(3)}-${d(4)}` : `010-0${d(3)}-${d(4)}`;
}

export function shopName(cat, r) {
  const c = CAT[cat] || CAT.restaurant;
  let t = r.pick(c.n);
  t = t.replace('{p}', r.pick(P)).replace('{m}', r.pick(PM)).replace('{c}', r.pick(PC));
  t = t.replace('{e}', r.pick(EN)).replace('{E}', ENC(r.pick(EN)));
  return t;
}

// ---------------------------------------------------------------- fonts
export const FONTS = {
  bold: ['Black Han Sans', 'Do Hyeon', '900 Noto Sans KR', '900 Gothic A1', '800 Gothic A1', '700 Noto Sans KR', 'Orbit', '800 Hahmlet'],
  round: ['Jua', '700 Dongle', '700 Sunflower', 'Gowun Dodum', 'Jua'],
  serif: ['900 Noto Serif KR', 'Song Myung', '800 Nanum Myeongjo', '700 Gowun Batang', '700 Noto Serif KR'],
  brush: ['Nanum Brush Script', 'East Sea Dokdo', 'Dokdo', 'Yeon Sung', 'Kirang Haerang'],
  hand: ['Nanum Pen Script', '700 Gaegu', 'Hi Melody', 'Gamja Flower', 'Poor Story', 'Single Day', 'Cute Font'],
  display: ['Gugi', 'Black And White Picture', 'Stylish'],
  enBold: ['Bebas Neue', '700 Oswald', 'Anton', 'Archivo Black', '800 Montserrat', 'Bungee'],
  enScript: ['Pacifico', 'Lobster', 'Great Vibes'],
  enSerif: ['700 Playfair Display', 'Abril Fatface', '500 Playfair Display'],
  enNeon: ['Monoton', 'Righteous', 'Pacifico', 'Permanent Marker', 'Lobster'],
  enMin: ['500 Montserrat', '300 Oswald', '400 Playfair Display', '600 Montserrat'],
};
export const EMOJI = 'Noto Emoji';

// Font groups that suit each vibe (Korean text).
const VIBE_FONTS = {
  trad: ['bold', 'bold', 'serif', 'brush', 'brush', 'round', 'display'],
  modern: ['bold', 'round', 'hand', 'serif', 'display'],
  night: ['bold', 'bold', 'display', 'round', 'brush'],
  pro: ['bold', 'bold', 'bold', 'serif', 'round'],
};

const isLatin = (t) => !/[ㄱ-힝]/.test(t);

function pickFont(r, vibe, text, latinGroup) {
  if (isLatin(text)) return r.pick(FONTS[latinGroup || r.pick(['enBold', 'enBold', 'enSerif', 'enScript', 'enMin'])]);
  return r.pick(FONTS[r.pick(VIBE_FONTS[vibe])]);
}

// ---------------------------------------------------------------- colors
// [background, text, accent] — typical Korean flex-sign combinations.
const FLEX = [
  ['#D7191C', '#FFFFFF', '#FFE14D'], ['#B5121B', '#FFE14D', '#FFFFFF'], ['#FFD200', '#C8102E', '#111111'],
  ['#FFD200', '#111111', '#C8102E'], ['#00843D', '#FFFFFF', '#FFE14D'], ['#0055A5', '#FFFFFF', '#FFE14D'],
  ['#1B2A5B', '#FFFFFF', '#F5C518'], ['#111111', '#FFD200', '#FFFFFF'], ['#111111', '#FFFFFF', '#E8272C'],
  ['#F5F5F0', '#C8102E', '#1B2A5B'], ['#F5F5F0', '#0055A5', '#D7191C'], ['#F5F5F0', '#111111', '#00843D'],
  ['#F07F1A', '#FFFFFF', '#5A2A0A'], ['#6A2C91', '#FFFFFF', '#FFD200'], ['#E85A9B', '#FFFFFF', '#5B1A3A'],
  ['#6B3E26', '#F3E6C4', '#FFD200'], ['#009B9B', '#FFFFFF', '#FFE14D'], ['#7A1F2B', '#F3E6C4', '#FFD200'],
  ['#F3E6C4', '#6B3E26', '#B5121B'], ['#3BA6E0', '#FFFFFF', '#1B2A5B'], ['#2E7D32', '#FFF8E1', '#FFCA28'],
  ['#FFFFFF', '#E65100', '#4E342E'], ['#263238', '#80DEEA', '#FFFFFF'], ['#880E4F', '#FFFFFF', '#F8BBD0'],
];
const PRO = [
  ['#FFFFFF', '#0B4EA2', '#00843D'], ['#FFFFFF', '#00843D', '#0B4EA2'], ['#0B4EA2', '#FFFFFF', '#9BD3F5'],
  ['#00843D', '#FFFFFF', '#E8F5E9'], ['#F5F5F0', '#1B2A5B', '#D7191C'], ['#1B2A5B', '#FFFFFF', '#FFD200'],
  ['#FFFFFF', '#5B2C83', '#00A0B0'], ['#00A0B0', '#FFFFFF', '#FFFFFF'],
];
const GALVA = [
  ['#2B2B2B', '#EDE7D9'], ['#151515', '#D4AF37'], ['#F2F2EE', '#222222'], ['#5C4033', '#F3E6C4'], ['#1F2A44', '#E8E2D0'],
  ['#3A3F44', '#FFFFFF'], ['#9AA0A6', '#111111'], ['#E9E2D3', '#3B2F2F'], ['#0E3B2E', '#E8D9B5'], ['#6E1E1E', '#F3E6C4'],
];
const CHANNEL = ['#FFFFFF', '#FFFFFF', '#FFD200', '#E8272C', '#1E88E5', '#43A047', '#FF7043', '#111111', '#F5E6C8'];
const NEON = ['#FF4FA3', '#3FE0FF', '#FFE14D', '#FF3B30', '#B266FF', '#4CFF7A', '#FFF1DC', '#FF8A3D'];
const SHEET = ['#FFFFFF', '#FFFFFF', '#FFD200', '#2F6FD6', '#D7191C', '#18A558', '#FF8A00'];
const BOX_ALU = '#A7ABB0';

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  const c = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- designs
const STYLE_W = {
  // kind -> vibe -> [style, weight]...
  fascia: {
    trad: [['flex', 70], ['galva', 18], ['channel', 12]],
    modern: [['galva', 34], ['channel', 34], ['flex', 20], ['neon', 12]],
    night: [['flex', 46], ['channel', 18], ['neon', 36]],
    pro: [['flex', 76], ['channel', 14], ['galva', 10]],
  },
  upper: {
    trad: [['flex', 50], ['sheet', 40], ['channel', 10]],
    modern: [['sheet', 40], ['channel', 30], ['flex', 20], ['neon', 10]],
    night: [['flex', 45], ['sheet', 35], ['neon', 20]],
    pro: [['sheet', 55], ['flex', 40], ['channel', 5]],
  },
};

function weighted(r, list) {
  const total = list.reduce((s, x) => s + x[1], 0);
  let v = r() * total;
  for (const [k, w] of list) if ((v -= w) < 0) return k;
  return list[0][0];
}

const SUBS_GENERIC = ['포장 · 배달', '24시', '연중무휴', '홍대점', '본점', '2호점', '단체석 완비', '예약환영', '주차가능', 'OPEN 11:00 - 22:00'];

export function makeDesign(req, index) {
  const r = rng(req.s ^ (index * 2654435761));
  const kind = req.k;
  const cat = CAT[req.c] ? req.c : 'restaurant';
  const info = CAT[cat];
  const d = {
    i: index, kind, cat, w: req.w, h: req.h, age: r() * r(), sub: [], emblem: null, off: 0, box: null,
  };

  if (kind === 'board') return boardDesign(req, r, d);
  if (kind === 'banner') return bannerDesign(r, d);
  if (kind === 'stack') return stackDesign(req, r, d);
  if (kind === 'exit') {
    // Generic metro exit sign (no operator logo): number tile + 출구.
    Object.assign(d, { style: 'exit', text: `${req.t} 출구`, no: req.t, glow: 'face', box: { color: '#2A2E36', depth: 0.12 } });
    return d;
  }

  const brand = req.c === 'brand';
  const name = brand ? req.t : shopName(cat, r);
  d.text = name;

  if (kind === 'vert') return vertDesign(r, d, brand ? 'night' : info.v, brand ? req : null);

  if (brand) {
    d.style = 'flex';
    d.bg = { type: r.chance(0.3) ? 'vgrad' : 'solid', c1: req.bg, c2: shade(req.bg, 0.8) };
    d.main = { text: name, font: isLatin(name) ? r.pick(['Archivo Black', '800 Montserrat', 'Anton']) : r.pick(['Black Han Sans', '900 Noto Sans KR', 'Do Hyeon']), color: req.fg };
    if (r.chance(0.5)) d.sub.push({ text: r.pick(['24시', '홍대점', '홍대입구역점', '연중무휴', 'OPEN']), color: req.fg, font: '700 Noto Sans KR' });
    d.box = { color: shade(req.bg, 0.6), depth: 0.22 };
    d.glow = 'face';
    return d;
  }

  const style = weighted(r, STYLE_W[kind === 'fascia' ? 'fascia' : 'upper'][info.v]);
  d.style = style;
  const vibe = info.v;
  const latin = isLatin(name);
  const icon = info.i.length ? r.pick(info.i) : null;
  const menu = info.m.length ? r.pick(info.m) : r.pick(SUBS_GENERIC);

  if (style === 'flex') {
    const pal = r.pick(vibe === 'pro' ? PRO : FLEX);
    d.bg = { type: weighted(r, [['solid', 45], ['vgrad', 25], ['band', 30]]), c1: pal[0], c2: r.chance(0.5) ? shade(pal[0], 0.78) : pal[2] };
    d.main = { text: name, font: pickFont(r, vibe, name), color: pal[1], stroke: r.chance(0.35) ? shade(pal[0], 0.45) : null, shadow: r.chance(0.3) };
    if (icon && r.chance(vibe === 'pro' ? 0.45 : 0.6)) { const eb = r.chance(0.5) ? pal[2] : '#FFFFFF'; d.emblem = { glyph: icon, bg: eb, ring: pal[1] === eb ? pal[0] : pal[1] }; }
    const subs = [menu, phone(r), r.pick(SUBS_GENERIC)];
    const n = r.chance(0.7) ? (r.chance(0.5) ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) d.sub.push({ text: subs[k], color: k === 0 ? pal[1] : pal[2] === pal[0] ? pal[1] : pal[2], font: r.pick(['700 Noto Sans KR', '500 Noto Sans KR', 'Do Hyeon', '700 Gothic A1']) });
    d.layout = r.pick(['right', 'below', 'right', 'band']);
    d.box = { color: r.chance(0.5) ? BOX_ALU : shade(pal[0], 0.55), depth: kind === 'fascia' ? 0.22 : 0.16 };
    d.glow = 'face';
  } else if (style === 'galva') {
    const pal = r.pick(GALVA);
    d.bg = { type: 'solid', c1: pal[0] };
    const metal = pal[1];
    d.main = { text: name, font: latin ? r.pick(FONTS[r.pick(['enSerif', 'enMin', 'enBold', 'enScript'])]) : pickFont(r, vibe, name), color: metal, metal: r.chance(0.5), spacing: latin ? r.int(2, 10) : r.int(0, 6) };
    if (r.chance(0.55)) d.sub.push({ text: latin ? r.pick(['since ' + r.int(1988, 2023), 'coffee & bakery', 'EST. ' + r.int(1995, 2023), menu]) : r.pick([menu, 'since ' + r.int(1978, 2022)]), color: metal, font: r.pick(['500 Montserrat', '300 Oswald', '400 Playfair Display', '500 Noto Sans KR']), spacing: 4 });
    d.layout = r.pick(['below', 'center', 'center']);
    d.box = { color: pal[0], depth: 0.06 };
    d.glow = r.chance(0.35) ? 'letters' : 'none';
  } else if (style === 'channel') {
    const col = r.pick(CHANNEL);
    d.bg = { type: 'none' };
    d.main = { text: name, font: latin ? r.pick(FONTS[r.pick(['enBold', 'enSerif', 'enScript'])]) : pickFont(r, vibe, name), color: col, ret: shade(col === '#111111' ? '#555555' : col, 0.5) };
    d.raceway = r.chance(0.55) ? r.pick(['#2B2B2B', '#8A8F94', '#D9D4C7', shade(col, 0.4)]) : null;
    if (icon && r.chance(0.25)) d.emblem = { glyph: icon, bg: col === '#FFFFFF' ? '#E8272C' : '#FFFFFF', ring: col };
    d.layout = 'center';
    d.off = 0.14;
    d.glow = 'letters';
  } else if (style === 'neon') {
    const tube = r.pick(NEON);
    d.bg = r.chance(0.6) ? { type: 'solid', c1: r.pick(['#0B0B10', '#111317', '#1A0E14', '#0E1418']) } : { type: 'none' };
    const en = latin ? name : r.chance(0.5) ? ENC(r.pick(EN)) : name;
    d.main = { text: en, font: isLatin(en) ? r.pick(FONTS.enNeon) : r.pick([...FONTS.round, ...FONTS.hand]), color: tube, neon: true };
    if (r.chance(0.4)) d.sub.push({ text: r.pick(['OPEN', 'BAR', 'LIVE', 'PUB', 'since ' + r.int(1999, 2023)]), color: r.pick(NEON), font: r.pick(FONTS.enNeon), neon: true });
    d.layout = 'center';
    d.box = d.bg.type === 'none' ? null : { color: d.bg.c1, depth: 0.05 };
    d.off = d.bg.type === 'none' ? 0.16 : 0.08;
    d.glow = 'letters';
  } else {
    // Window lettering (cut vinyl) on upper floors.
    const col = r.pick(SHEET);
    d.bg = { type: 'none' };
    d.main = { text: name, font: pickFont(r, vibe, name, 'enBold'), color: col, stroke: r.chance(0.4) ? '#1A1A1A' : null };
    if (r.chance(0.75)) d.sub.push({ text: r.chance(0.6) ? phone(r) : menu, color: r.chance(0.5) ? col : '#FFFFFF', font: r.pick(['700 Noto Sans KR', 'Do Hyeon', 'Black Han Sans']) });
    if (r.chance(0.35)) d.floorTag = { text: `${(req.f || 1) + 1}F`, color: col };
    d.layout = r.pick(['below', 'right']);
    d.off = 0.22;
    d.glow = 'none';
  }
  return d;
}

function vertDesign(r, d, vibe, brandReq) {
  d.style = 'vflex';
  // Projecting signs carry short words (trade word, sometimes with a prefix).
  let text = brandReq ? d.text : shortName(d.cat, r);
  d.text = text;
  const pal = brandReq ? [brandReq.bg, brandReq.fg, '#FFFFFF'] : r.pick(vibe === 'pro' ? PRO : FLEX);
  d.bg = { type: weighted(r, [['solid', 50], ['blocks', 25], ['vgrad', 25]]), c1: pal[0], c2: brandReq ? shade(pal[0], 0.7) : r.chance(0.5) ? pal[2] : shade(pal[0], 0.7) };
  d.main = { text, font: isLatin(text) ? r.pick(FONTS.enBold) : r.pick(FONTS[r.pick(['bold', 'bold', 'round', 'display', 'serif'])]), color: pal[1], stroke: r.chance(0.3) ? shade(pal[0], 0.45) : null };
  const info = CAT[d.cat];
  if (!brandReq && info && info.i.length && r.chance(0.45)) d.emblem = { glyph: r.pick(info.i), bg: '#FFFFFF', ring: pal[1] === '#FFFFFF' ? pal[0] : pal[1] };
  if (r.chance(0.3)) d.sub.push({ text: r.pick(['24시', '2F', '3F', 'B1', 'OPEN']), color: pal[2] === pal[0] ? pal[1] : pal[2], font: '900 Noto Sans KR' });
  d.box = { color: r.chance(0.5) ? BOX_ALU : shade(pal[0], 0.5), depth: 0.32 };
  d.glow = 'face';
  return d;
}

function stackDesign(req, r, d) {
  d.style = 'stack';
  const ten = req.ten.length ? req.ten : ['karaoke', 'pc', 'hof'];
  // Top floor first (panels are drawn top-down).
  d.tenants = ten.map((c, k) => {
    const rr = rng(req.s + k * 7919);
    const info = CAT[c] || CAT.restaurant;
    const name = shortName(c, rr);
    const pal = rr.pick(info.v === 'pro' ? PRO : FLEX);
    return {
      text: name, floor: `${k + 2}F`, bg: pal[0], fg: pal[1], acc: pal[2],
      font: isLatin(name) ? rr.pick(FONTS.enBold) : rr.pick(FONTS[rr.pick(['bold', 'bold', 'round', 'serif', 'display'])]),
    };
  }).reverse();
  d.box = { color: r.pick(['#D9DCDF', BOX_ALU, '#2B2E33']), depth: 0.3 };
  d.glow = 'face';
  return d;
}

function boardDesign(req, r, d) {
  d.style = 'board';
  d.text = req.t;
  d.bg = { type: 'vgrad', c1: req.bg, c2: shade(req.bg, 0.6) };
  d.main = { text: req.t, font: isLatin(req.t) ? r.pick(['Archivo Black', 'Anton', '900 Montserrat']) : r.pick(['Black Han Sans', '900 Noto Sans KR', 'Do Hyeon']), color: req.fg };
  d.sub.push({ text: r.pick(['새로운 맛의 시작', '지금 바로 만나보세요', '오늘도 함께', '더 가까이, 더 새롭게', 'NEW OPEN', '언제 어디서나']), color: req.fg, font: '700 Noto Sans KR' });
  d.box = { color: '#2A2C30', depth: 0.5, legs: true };
  d.glow = 'face';
  return d;
}

function bannerDesign(r, d) {
  d.style = 'banner';
  d.text = '임대';
  d.bg = { type: 'solid', c1: r.pick(['#FFFFFF', '#FFFFFF', '#FFF6C9', '#FFE600']) };
  d.main = { text: r.pick(['임 대', '임대문의', '사무실 임대', '상가 임대', '임 대']), font: r.pick(['Black Han Sans', '900 Noto Sans KR', 'Do Hyeon']), color: r.pick(['#D7191C', '#0B4EA2', '#D7191C']) };
  d.sub.push({ text: phone(r), color: '#0B4EA2', font: '900 Noto Sans KR' });
  d.layout = 'right';
  d.off = 0;
  d.glow = 'none';
  return d;
}

export const DENSITY = { fascia: 56, vert: 56, stack: 46, upper: 44, banner: 40, board: 30, exit: 72 };
