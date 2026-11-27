// Sign design generator: turns a sign request (kind, business category,
// size) into a concrete design spec. Deterministic per request seed.
//
// Names follow common Korean naming habits rather than random word mixes:
//   한식: 지역 + 음식(의정부부대찌개), 사람 + 음식(할매순대국), 수식 + 음식(원조닭한마리)
//   오락·서비스: 영어 단어의 한글 표기 + 업종(드림PC방, 블룸헤어)
//   병원·학원·부동산: 동네 이름이나 흔한 수식어 + 업종(홍대바른정형외과)
//   외국 음식점·외국 브랜드: 원래 언어와 글자, 그 나라 간판 양식(居酒屋 月, 北京飯店, Phở)
// All names are fictional generic patterns; real chains arrive already renamed
// to their parody names (brand-bible.md). Phone numbers use 02-0xxx / 010-0xxx,
// which are never assigned in Korea.

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

// ---------------------------------------------------------------- word lists
// English words as used on Korean signs: [Latin, Hangul spelling].
const TR = [
  ['MOMENT', '모먼트'], ['DAILY', '데일리'], ['MELLOW', '멜로우'], ['SLOW', '슬로우'], ['COZY', '코지'], ['BLOOM', '블룸'],
  ['SUNDAY', '선데이'], ['PLAIN', '플레인'], ['WEEKEND', '위켄드'], ['IVORY', '아이보리'], ['ROUTINE', '루틴'], ['LAYER', '레이어'],
  ['UNION', '유니온'], ['STONE', '스톤'], ['CLOUD', '클라우드'], ['MAPLE', '메이플'], ['OLIVE', '올리브'], ['HONEY', '허니'],
  ['PEACH', '피치'], ['LEMON', '레몬'], ['MINT', '민트'], ['BUTTER', '버터'], ['VELVET', '벨벳'], ['RETRO', '레트로'],
  ['ECHO', '에코'], ['LOOP', '루프'], ['GROOVE', '그루브'], ['JAZZ', '재즈'], ['SOUL', '소울'], ['URBAN', '어반'],
  ['LUNA', '루나'], ['STELLA', '스텔라'], ['NOVA', '노바'], ['HARBOR', '하버'], ['CORNER', '코너'], ['GARDEN', '가든'],
  ['LUCKY', '럭키'], ['HAPPY', '해피'], ['STAR', '스타'], ['MOON', '문'], ['SKY', '스카이'], ['BLUE', '블루'], ['GOLD', '골드'],
  ['DREAM', '드림'], ['ACE', '에이스'], ['TOP', '탑'], ['KING', '킹'], ['SUNNY', '써니'], ['ROSE', '로즈'], ['JELLY', '젤리'],
  ['CANDY', '캔디'], ['SUPER', '슈퍼'], ['HERO', '히어로'], ['LEGEND', '레전드'], ['BEAT', '비트'], ['PLAY', '플레이'],
  ['SMILE', '스마일'], ['PRIME', '프라임'], ['POP', '팝'], ['PINK', '핑크'], ['CHERRY', '체리'], ['ONE', '원'], ['FRIENDS', '프렌즈'],
  ['NEW YORK', '뉴욕'], ['PARIS', '파리'], ['HAWAII', '하와이'], ['MIRACLE', '미라클'], ['FOREST', '포레스트'],
];
// Words that suit games / karaoke / PC rooms (loud, simple).
const TR_FUN = ['럭키', '스타', '드림', '에이스', '탑', '킹', '해피', '슈퍼', '히어로', '레전드', '비트', '플레이', '골드', '블루', '뉴욕', '팝', '미라클', '프렌즈', '스마일'];
// English names for cafes, bars, boutiques (Latin script on the sign).
const EN = [
  'Moment', 'Daily', 'Mellow', 'Slow', 'Cozy', 'Bloom', 'Haze', 'Sunday', 'Plain', 'Ordinary', 'Weekend', 'Nook', 'Lumen', 'Ivory',
  'Oat', 'Fig', 'Routine', 'Layer', 'Blank', 'Union', 'North', 'Stone', 'Folk', 'Tide', 'Cloud', 'Maple', 'Olive', 'Honey',
  'Velvet', 'Retro', 'Echo', 'Loop', 'Groove', 'Soul', 'Urban', 'Luna', 'Stella', 'Nova', 'Harbor', 'Corner', 'Alley', 'Attic',
  'Garden', 'Yard', 'Common', 'Pause', 'Archive', 'Field', 'Paper', 'Linen', 'Grain', 'Amber', 'Marble',
];
// Calm Korean words for cafes and small shops.
const KO_SOFT = ['온기', '하루', '다락', '공간', '소담', '온도', '모퉁이', '오후', '한낮', '이음', '쉼표', '달', '별', '구름', '담장', '마당', '골목', '숲', '볕', '틈', '결', '우물', '나무', '바람'];
// Neighbourhood names around the map.
const PLACE = ['홍대', '서교', '연남', '합정', '상수', '동교', '망원', '마포', '신촌', '와우'];
// Plain modifiers for everyday shops (laundry, mart, pharmacy, estate agent).
const K_SHOP = ['행복', '우리', '제일', '한빛', '미소', '사랑', '늘봄', '새봄', '하나', '대박', '행운', '으뜸', '친절', '365', '24시', '한가족', '알뜰', '싱싱', '백조', '명품', '크린'];
// Modifiers clinics actually use.
const K_MED = ['연세', '서울', '바른', '밝은', '맑은', '튼튼', '365', '우리', '미소', '하나', '새봄', '고운', '참', '편한'];
const PERSON = ['할매', '할머니', '엄마', '이모', '고모', '삼촌', '김씨네', '박씨네', '이가네', '최가네', '정가네', '윤씨네', '한씨네', '시골집', '큰집'];
const MOD_FOOD = ['원조', '옛날', '소문난', '진짜', '착한', '정직한', '명가', '본가', '토속', '시골', '고향', '맛있는', '일등', '황금', '큰손', '대박'];
const ACADEMY = ['이룸', '명문', '탑클래스', '일등', '해냄', '바른', '생각하는', '다온', '한빛', '최상위', '정상', '참'];

// 지역 + 음식 pairs that read as natural Korean restaurant names.
const REGION_DISH = [
  ['전주', '콩나물국밥'], ['전주', '비빔밥'], ['의정부', '부대찌개'], ['춘천', '닭갈비'], ['안동', '찜닭'], ['마산', '아구찜'],
  ['부산', '돼지국밥'], ['병천', '순대'], ['나주', '곰탕'], ['평양', '냉면'], ['함흥', '냉면'], ['남원', '추어탕'],
  ['통영', '충무김밥'], ['제주', '흑돼지'], ['포천', '이동갈비'], ['수원', '왕갈비'], ['담양', '떡갈비'], ['진주', '냉면'],
  ['광장', '빈대떡'], ['신당동', '떡볶이'], ['마포', '소금구이'], ['마포', '돼지갈비'], ['장충동', '족발'], ['을지로', '노가리'],
  ['영천', '순대국'], ['서교동', '감자탕'], ['연남동', '칼국수'], ['홍대', '곱창'], ['강릉', '초당순두부'], ['여수', '돌게장'],
];
const DISH_KO = ['순대국', '국밥', '해장국', '설렁탕', '곰탕', '감자탕', '뼈해장국', '순두부', '김치찌개', '백반', '제육볶음', '칼국수', '수제비', '냉면', '쌈밥', '보쌈', '족발', '닭한마리', '닭갈비', '부대찌개', '추어탕', '육개장', '갈비탕', '생선구이', '김치찜', '쭈꾸미', '낙지볶음'];
const DISH_BBQ = ['삼겹살', '소금구이', '돼지갈비', '숯불갈비', '곱창', '막창', '생고기', '한우', '목살', '갈매기살', '양갈비'];
const DISH_SNACK = ['김밥', '떡볶이', '분식', '튀김', '순대', '라볶이', '즉석떡볶이'];

// Foreign-language names: [native, Korean reading]
const JA_NAME = [['花', '하나'], ['夢', '유메'], ['桜', '사쿠라'], ['月', '츠키'], ['空', '소라'], ['風', '카제'], ['鳥', '토리'], ['山', '야마'], ['海', '우미'], ['森', '모리'], ['春', '하루'], ['灯', '아카리'], ['縁', '엔'], ['竹', '타케'], ['凛', '린']];
const ZHK_PRE = [['북경', '北京'], ['상해', '上海'], ['천진', '天津'], ['만리', '萬里'], ['황금', '黃金'], ['용', '龍'], ['봉황', '鳳凰'], ['복', '福'], ['태화', '太和'], ['대성', '大成'], ['동해', '東海'], ['금', '金'], ['신', '新'], ['홍', '鴻']];
const ZHK_SUF = [['반점', '飯店'], ['각', '閣'], ['루', '樓'], ['성', '城'], ['원', '園'], ['관', '館']];
const ZH_MALA = [['샤오롱', '小龙'], ['촨웨이', '川味'], ['슈샹', '蜀香'], ['하오츠', '好吃'], ['라오탕', '老汤'], ['훙윈', '鸿运'], ['푸만', '福满']];
const VI_NAME = ['Hà Nội', 'Sài Gòn', 'Việt', 'Huế', 'Đà Nẵng', 'Hạ Long', 'Hội An'];
const IT_NAME = ['Bella', 'Luna', 'Sole', 'Nonna', 'Amici', 'Piccolo', 'Gusto', 'Vino', 'Roma', 'Napoli', 'Mia', 'Dolce'];
const FR_NAME = ['Lumière', 'Petit', 'Belle', 'Maison', 'Douce', 'Soleil', 'Matin', 'Blanc', 'Chérie'];
const MX_NAME = ['El Sol', 'La Casa', 'Amigos', 'Fiesta', 'Chile', 'Sabor', 'Luna'];
const TH = [['ครัวไทย', 'Krua Thai'], ['สยาม', 'Siam'], ['สวัสดี', 'Sawasdee'], ['บางกอก', 'Bangkok'], ['เชียงใหม่', 'Chiang Mai']];

// Foreign brands keep their original Latin-script look (parody names).
export const BRAND_LATIN = {
  스타덕스: ['STARDUCKS', 'COFFEE'], 식스텐: ['SIX-TEN', ''], 올리브올드: ['OLIVE OLD', ''], 다사소: ['DASASO', '다사소'],
  라떼리아: ['LATTERIA', ''], 라떼시네마: ['LATTE CINEMA', ''], 기가박스: ['GIGABOX', ''], 기가커피: ['GIGA COFFEE', ''],
  심송: ['SIMSONG', ''], 뭐신사: ['MWOSINSA', ''], '뭐신사 스탠다드': ['MWOSINSA STANDARD', ''],
};

// ---------------------------------------------------------------- categories
// v: vibe (font/style family), i: icon emoji, m: sub lines (menu, services)
const CAT = {
  restaurant: { v: 'trad', i: ['🍲', '🍚', '🥘'], m: ['점심특선 · 저녁 · 포장', '단체석 완비', '정성을 다하는 집', '포장 · 배달'] },
  korean: { v: 'trad', i: ['🍲', '🥣'], m: ['순대국 · 수육 · 머릿고기', '24시 영업', '가마솥 사골육수'] },
  baekban: { v: 'trad', i: ['🍚', '🥢'], m: ['오늘의 백반 · 제육 · 찌개', '한식 뷔페'] },
  gukbap: { v: 'trad', i: ['🍲'], m: ['국밥 · 수육 · 소주', '24시'] },
  bbq: { v: 'trad', i: ['🥩', '🐷', '🔥'], m: ['삼겹살 · 목살 · 항정살', '국내산 생고기', '숯불 직화구이'] },
  snack: { v: 'snack', i: ['🍢', '🍙'], m: ['떡볶이 · 순대 · 튀김 · 김밥', '포장 전문', '라면 · 김밥 · 돈까스'] },
  tteokbokki: { v: 'snack', i: ['🌶️', '🍢'], m: ['매운맛 · 순한맛 · 치즈', '즉석 떡볶이'] },
  chicken: { v: 'snack', i: ['🍗', '🐔'], m: ['후라이드 · 양념 · 간장 · 파닭', '배달 · 포장', '치킨 & 호프'] },
  japanese: { v: 'ja', i: ['🍱', '🍤'], m: [] },
  ramen: { v: 'ja', i: ['🍜'], m: [] },
  izakaya: { v: 'ja', i: ['🏮', '🍶'], m: [] },
  sushi: { v: 'ja', i: ['🍣'], m: [] },
  chinese: { v: 'zhk', i: ['🥟'], m: ['짜장 · 짬뽕 · 탕수육', '중화요리', '배달 됩니다'] },
  mala: { v: 'zh', i: ['🌶️'], m: [] },
  vietnamese: { v: 'vi', i: ['🍜'], m: [] },
  thai: { v: 'th', i: ['🍛'], m: [] },
  italian: { v: 'it', i: ['🍝', '🍕'], m: [] },
  pizza: { v: 'it', i: ['🍕'], m: [] },
  western: { v: 'latin', i: ['🍝', '🍷'], m: ['PASTA · STEAK · WINE', 'BRUNCH'] },
  mexican: { v: 'mx', i: ['🌮'], m: [] },
  indian: { v: 'latin', i: ['🍛'], m: ['인도 커리 · 난 · 탄두리'] },
  burger: { v: 'latin', i: ['🍔'], m: ['HANDMADE BURGER', 'BURGER & BEER'] },
  cafe: { v: 'cafe', i: ['☕'], m: ['COFFEE · TEA · DESSERT', 'specialty coffee', 'coffee & dessert'] },
  dessert: { v: 'cafe', i: ['🍰', '🧁'], m: ['cake & coffee', 'DESSERT CAFE'] },
  bakery: { v: 'cafe', i: ['🍞', '🥐'], m: ['매일 아침 굽는 빵', 'BREAD · CAKE · COFFEE'] },
  icecream: { v: 'cafe', i: ['🍦'], m: ['GELATO'] },
  hof: { v: 'night', i: ['🍺'], m: ['생맥주 · 치킨 · 노가리', '시원한 생맥주'] },
  pocha: { v: 'trad', i: ['🍶'], m: ['닭발 · 오돌뼈 · 계란말이', '안주 · 소주 · 맥주'] },
  bar: { v: 'latin', i: ['🍸', '🍷'], m: ['COCKTAIL · WHISKEY · WINE', 'LIVE MUSIC'] },
  club: { v: 'latin', i: ['🎧'], m: ['EVERY FRI & SAT', 'HIPHOP · EDM · HOUSE'] },
  karaoke: { v: 'night', i: ['🎤'], m: ['최신곡 · 단체룸', '노래연습장'] },
  coinkaraoke: { v: 'night', i: ['🎤'], m: ['1곡 500원 · 24시', '무인 운영'] },
  pc: { v: 'night', i: ['🖥️', '🎮'], m: ['최신사양 · 고급의자 · 24시', 'PC CAFE'] },
  billiards: { v: 'night', i: ['🎱'], m: ['포켓볼 · 3쿠션 · 4구', '당구클럽'] },
  arcade: { v: 'night', i: ['🕹️', '🎮'], m: ['인형뽑기 · 리듬게임', '게임센터'] },
  roomcafe: { v: 'night', i: ['🛋️'], m: ['보드게임 · 영화 · 음료 무한리필'] },
  manga: { v: 'night', i: ['📚'], m: ['만화 · 라면 · 음료'] },
  boardgame: { v: 'night', i: ['🎲'], m: ['보드게임 300여종'] },
  escape: { v: 'night', i: ['🔑'], m: ['테마 6종 · 예약제'] },
  hair: { v: 'beauty', i: ['✂️'], m: ['CUT · PERM · COLOR', '커트 · 펌 · 염색 · 클리닉'] },
  nail: { v: 'beauty', i: ['💅'], m: ['젤네일 · 속눈썹 · 왁싱'] },
  cosmetics: { v: 'latin', i: ['💄'], m: ['SKINCARE · MAKEUP'] },
  clinic: { v: 'pro', i: ['🩺'], m: ['감기 · 예방접종 · 건강검진', '진료시간 09:00 - 19:00', '전문의 진료'] },
  dentist: { v: 'pro', i: ['🦷'], m: ['임플란트 · 교정 · 충치치료', '야간진료'] },
  pharmacy: { v: 'pro', i: ['💊'], m: ['처방조제 · 일반의약품'] },
  realestate: { v: 'pro', i: ['🏠'], m: ['매매 · 전세 · 월세 · 상가', '원룸 · 투룸 · 사무실'] },
  academy: { v: 'pro', i: ['✏️'], m: ['초 · 중 · 고 · 내신 · 수능', '소수정예 · 1:1 관리'] },
  music_academy: { v: 'pro', i: ['🎸', '🎵'], m: ['보컬 · 기타 · 드럼 · 작곡', '입시 · 취미 · 오디션'] },
  pilates: { v: 'pro', i: ['🧘'], m: ['1:1 PT · 그룹레슨', 'GX · PT · 필라테스'] },
  studio: { v: 'night', i: ['📷', '🎙️'], m: ['합주실 · 녹음 · 연습실', '셀프 사진관'] },
  guesthouse: { v: 'latin', i: ['🛏️'], m: ['DORMITORY · PRIVATE ROOM'] },
  hotel: { v: 'pro', i: ['🛎️'], m: ['대실 · 숙박'] },
  clothes: { v: 'latin', i: ['👕'], m: ['NEW ARRIVAL', 'MEN · WOMEN'] },
  vintage: { v: 'latin', i: ['👖'], m: ['VINTAGE · USED', '구제 의류'] },
  shoes: { v: 'latin', i: ['👟'], m: ['SNEAKERS'] },
  mart: { v: 'pro', i: ['🛒'], m: ['신선식품 · 생활용품 · 배달', '연중무휴'] },
  gift: { v: 'cafe', i: ['🎁'], m: ['소품 · 문구 · 선물'] },
  stationery: { v: 'pro', i: ['✏️'], m: ['문구 · 팬시 · 복사'] },
  books: { v: 'cafe', i: ['📚'], m: ['독립출판 · 중고책'] },
  music: { v: 'pro', i: ['🎸'], m: ['기타 · 앰프 · 수리'] },
  liquor: { v: 'latin', i: ['🍷'], m: ['WINE · WHISKY'] },
  photo: { v: 'night', i: ['📷'], m: ['증명사진 · 여권사진', '셀프 사진관'] },
  tattoo: { v: 'latin', i: ['🖋️'], m: ['TATTOO & PIERCING'] },
  massage: { v: 'th', i: ['💆'], m: [] },
  laundry: { v: 'pro', i: ['🧺'], m: ['드라이클리닝 · 수선', '24시 무인 빨래방'] },
  optician: { v: 'pro', i: ['👓'], m: ['안경 · 콘택트렌즈'] },
  phone: { v: 'pro', i: ['📱'], m: ['번호이동 · 기기변경'] },
  church: { v: 'pro', i: ['⛪'], m: ['주일예배 11:00'] },
  bank: { v: 'pro', i: ['🏦'], m: ['ATM 24시'] },
  rent: { v: 'pro', i: [], m: [] },
};

export function phone(r) {
  const d = (n) => Array.from({ length: n }, () => r.int(0, 9)).join('');
  return r.chance(0.6) ? `02-0${d(3)}-${d(4)}` : `010-0${d(3)}-${d(4)}`;
}

const isLatin = (t) => !/[ㄱ-힝぀-ヿ一-鿿฀-๿]/.test(t);
const tr = (r) => r.pick(TR);

/**
 * Natural shop name: { main, sub?, script, flavor }.
 * script: ko | latin | ja | zhT (traditional hanja) | zhS (simplified) | th
 */
export function makeName(cat, r) {
  const p = r.pick;
  const ko = (main, sub) => ({ main, sub, script: 'ko', flavor: 'ko' });
  const la = (main, sub) => ({ main, sub, script: 'latin', flavor: 'latin' });
  switch (cat) {
    case 'restaurant':
    case 'korean':
    case 'baekban':
    case 'gukbap': {
      const k = r();
      if (k < 0.3) { const [rg, dish] = p(REGION_DISH); return ko(`${rg}${dish}`); }
      if (k < 0.55) return ko(`${p(PERSON)}${p(DISH_KO)}`);
      if (k < 0.75) return ko(`${p(MOD_FOOD)}${p(DISH_KO)}`);
      if (k < 0.88) return ko(`${p(DISH_KO)}${p(['집', '전문점', ' 본점', '명가'])}`);
      return ko(`${p([...PLACE, '시골', '고향', '토담', '장독대'])}${p(['식당', '밥상', '한식'])}`);
    }
    case 'bbq': {
      const k = r();
      if (k < 0.3) return ko(`${p(['마포', '홍대', '연남', '제주', '포천', '수원', '서교'])}${p(DISH_BBQ)}`);
      if (k < 0.55) return ko(`${p(PERSON)}${p(DISH_BBQ)}`);
      if (k < 0.8) return ko(`${p(MOD_FOOD)}${p(DISH_BBQ)}`);
      return ko(`${p(DISH_BBQ)}${p(['집', '구이', ' 전문점'])}`);
    }
    case 'snack':
    case 'tteokbokki': {
      const k = r();
      if (k < 0.35) return ko(`${p(PERSON)}${p(DISH_SNACK)}`);
      if (k < 0.6) return ko(`${p([...PLACE, '신당동', '학교앞', '시장'])}${p(DISH_SNACK)}`);
      return ko(`${p(MOD_FOOD)}${p(DISH_SNACK)}`);
    }
    case 'chicken': {
      const k = r();
      if (k < 0.3) return ko(`${p(['옛날', '시장', '원조', '동네', '추억의'])}통닭`);
      if (k < 0.6) return ko(`${p([...PLACE, '바삭', '정직한', '착한', '우리동네'])}치킨`);
      return ko(`${tr(r)[1]}치킨`);
    }
    case 'pocha': return ko(`${p([...KO_SOFT, ...PLACE, '옛날', '청춘', '골목'])}${p(['포차', '포장마차', '주막'])}`);
    case 'hof': {
      if (r.chance(0.5)) return ko(`${p([...K_SHOP.slice(0, 12), ...PLACE])}${p(['호프', '생맥주', '맥주'])}`);
      return ko(`${tr(r)[1]}${p(['비어', '호프', ' 펍'])}`);
    }
    case 'japanese':
    case 'ramen':
    case 'izakaya':
    case 'sushi': {
      const [kj, kr] = p(JA_NAME);
      const kind = cat === 'japanese' ? p(['katsu', 'udon', 'shokudo']) : cat;
      const forms = {
        izakaya: [`居酒屋 ${kj}`, `이자카야 ${kr}`],
        ramen: [p([`らーめん ${kj}`, `${kj}ラーメン`, `麺屋 ${kj}`]), `라멘 ${kr}`],
        sushi: [p([`寿司 ${kj}`, `${kj}鮨`]), `스시 ${kr}`],
        katsu: [`とんかつ ${kj}`, `돈카츠 ${kr}`],
        udon: [`${kj} うどん`, `우동 ${kr}`],
        shokudo: [`${kj}食堂`, `${kr} 식당`],
      }[kind];
      return { main: forms[0], sub: forms[1], script: 'ja', flavor: 'ja' };
    }
    case 'chinese': {
      const [pk, pz] = p(ZHK_PRE);
      // Avoid doubled syllables (대성성) by re-picking the suffix.
      let [sk, sz] = p(ZHK_SUF);
      if (pk.endsWith(sk)) [sk, sz] = ZHK_SUF[0];
      return { main: `${pk}${sk}`, sub: `${pz}${sz}`, script: 'ko', flavor: 'zhk' };
    }
    case 'mala': {
      const [nk, nz] = p(ZH_MALA);
      const dish = r.chance(0.7) ? ['麻辣烫', '마라탕'] : ['羊肉串', '양꼬치'];
      return { main: `${nz}${dish[0]}`, sub: `${nk} ${dish[1]}`, script: 'zhS', flavor: 'zh' };
    }
    case 'vietnamese': return { main: `Phở ${p(VI_NAME)}`, sub: '베트남 쌀국수', script: 'latin', flavor: 'vi' };
    case 'thai': { const [t, l] = p(TH); return { main: t, sub: `${l} · 태국 음식`, script: 'th', flavor: 'th' }; }
    case 'massage': { const [t] = p(TH); return { main: `${p(['타이', '정통 타이', '스파'])}마사지`, sub: t, script: 'ko', flavor: 'th' }; }
    case 'italian':
    case 'pizza': return { main: `${p(cat === 'pizza' ? ['Pizzeria', 'Pizza'] : ['Trattoria', 'Osteria', 'Cucina'])} ${p(IT_NAME)}`, sub: p(['화덕피자 · 파스타', 'PIZZA · PASTA · VINO', '이탈리안 레스토랑']), script: 'latin', flavor: 'it' };
    case 'mexican': return { main: `${p(['Taquería', 'Tacos'])} ${p(MX_NAME)}`, sub: '타코 · 부리또 · 나초', script: 'latin', flavor: 'mx' };
    case 'indian': return la(p(['NAMASTE', 'TAJ CURRY', 'INDIA GATE', 'MASALA']), '인도 커리 · 난 · 탄두리');
    case 'burger': return r.chance(0.6) ? la(`${p(EN)} Burger`, 'HANDMADE BURGER') : ko(`${tr(r)[1]}버거`, '수제버거');
    case 'western': return la(`${p(EN)} ${p(['Bistro', 'Kitchen', 'Dining', 'Table'])}`);
    case 'cafe':
    case 'dessert':
    case 'icecream': {
      const k = r();
      const word = cat === 'dessert' ? p(['Bake', 'Sweets', 'Cake', 'Dessert']) : cat === 'icecream' ? 'Gelato' : p(['Coffee', 'Coffee', 'Roasters', 'Cafe']);
      if (k < 0.55) return la(r.chance(0.5) ? `${p(EN)} ${word}` : p(EN));
      if (k < 0.8) return ko(`카페 ${p(KO_SOFT)}`);
      return ko(`${p(KO_SOFT)}${p(['커피', '다방', '제과'])}`);
    }
    case 'bakery':
      if (r.chance(0.3)) return { main: `Boulangerie ${p(FR_NAME)}`, sub: '베이커리', script: 'latin', flavor: 'fr' };
      return r.chance(0.5) ? ko(`${p([...KO_SOFT, ...K_SHOP.slice(0, 10)])}${p(['베이커리', '제과', '빵집'])}`) : la(`${p(EN)} Bakery`);
    case 'bar': return la(p([`${p(EN)} Bar`, `Bar ${p(EN)}`, `${p(EN)} Pub`, `${p(EN)} Lounge`, `LP Bar ${p(EN)}`]));
    case 'club': return la(r.chance(0.5) ? `Club ${p(EN)}` : p(EN).toUpperCase());
    case 'karaoke': return ko(`${p(TR_FUN)}${p(['노래연습장', '노래방', '노래타운'])}`);
    case 'coinkaraoke': return ko(`${p(TR_FUN)}${p(['코인노래방', '코인노래연습장'])}`);
    case 'pc': return ko(`${p(TR_FUN)}${p(['PC방', 'PC방', ' PC CAFE', 'PC'])}`);
    case 'billiards': return ko(`${p([...TR_FUN, ...K_SHOP.slice(0, 8)])}${p(['당구장', '당구클럽'])}`);
    case 'arcade': return ko(r.chance(0.5) ? `${p(TR_FUN)}${p(['게임랜드', '게임센터', '오락실'])}` : `인형뽑기 ${p(TR_FUN)}`);
    case 'roomcafe': return ko(`${tr(r)[1]} 룸카페`);
    case 'manga': return ko(`${p([...KO_SOFT, ...TR_FUN])} 만화카페`);
    case 'boardgame': return ko(`${tr(r)[1]} 보드게임카페`);
    case 'escape': return ko(`${tr(r)[1]} 방탈출`);
    case 'hair': {
      const k = r();
      if (k < 0.3) return ko(`${tr(r)[1]}헤어`, 'HAIR SALON');
      if (k < 0.5) return ko(`헤어${tr(r)[1]}`);
      if (k < 0.7) return ko(`${p(['장미', '명동', '행복', '미소', '청담', '사랑', '보라', '단골'])}미용실`);
      if (k < 0.85) return ko(`${p(['지수', '민지', '수진', '현아', '은영', '준호', '태민', '하린'])} 헤어`, 'hair studio');
      return la(`${p(EN)} hair`, 'HAIR SALON');
    }
    case 'nail': return r.chance(0.6) ? ko(`${tr(r)[1]}네일`, 'NAIL & LASH') : la(`${p(EN)} Nail`);
    case 'cosmetics': return la(`${p(EN)} ${p(['Beauty', 'Cosmetics', 'Skin'])}`);
    case 'clinic': {
      const dept = p(['내과', '이비인후과', '피부과', '정형외과', '소아청소년과', '안과', '가정의학과', '재활의학과', '한의원', '비뇨의학과']);
      const name = r.chance(0.4) ? `${p(PLACE)}${p(K_MED)}${dept}` : `${p(K_MED)}${dept}`;
      return ko(dept === '한의원' || r.chance(0.5) ? name : `${name}의원`);
    }
    case 'dentist': return ko(r.chance(0.4) ? `${p(PLACE)}${p(K_MED)}치과` : `${p(K_MED)}치과의원`);
    case 'pharmacy': return ko(`${p([...K_MED, ...PLACE, '사랑', '늘봄', '건강'])}약국`);
    case 'optician': return ko(`${p(['밝은', '맑은', '으뜸', ...PLACE])}안경`);
    case 'realestate': {
      const k = r();
      if (k < 0.4) return ko(`${p(PLACE)}공인중개사사무소`);
      if (k < 0.75) return ko(`${p(K_SHOP)}부동산`);
      return ko(`${p([...PLACE, ...K_SHOP])} 공인중개사`);
    }
    case 'academy': {
      const subj = p(['수학학원', '수학', '영어학원', '영어', '입시학원', '국어', '논술', '미술학원', '코딩학원']);
      return ko(r.chance(0.2) ? `${tr(r)[1]} 잉글리쉬` : `${p(ACADEMY)}${subj}`);
    }
    case 'music_academy': return ko(r.chance(0.5) ? `${tr(r)[1]}${p(['실용음악학원', '실용음악', ' 보컬', ' 드럼'])}` : `${tr(r)[1]} ${p(['댄스', '댄스스튜디오', '댄스아카데미'])}`);
    case 'pilates': return r.chance(0.7) ? ko(`${tr(r)[1]}${p(['필라테스', '요가', '휘트니스', ' PT'])}`) : la(`${p(EN)} ${p(['GYM', 'PILATES', 'FITNESS'])}`);
    case 'studio': return ko(r.chance(0.5) ? `${tr(r)[1]} ${p(['스튜디오', '녹음실', '합주실', '연습실'])}` : `셀프사진관 ${tr(r)[1]}`);
    case 'photo': return ko(r.chance(0.5) ? `${p(K_SHOP)}사진관` : `${tr(r)[1]} 포토`);
    case 'guesthouse': return la(`${p(EN)} ${p(['Guesthouse', 'Hostel', 'Stay'])}`);
    case 'hotel': return ko(r.chance(0.5) ? `호텔 ${tr(r)[1]}` : `${tr(r)[1]}${p(['모텔', '호텔'])}`);
    case 'clothes': return la(r.chance(0.6) ? p(EN) : `${p(EN)} ${p(['Store', 'Select', 'Studio', 'Shop'])}`);
    case 'vintage': return r.chance(0.7) ? la(`${p(EN)} Vintage`) : ko(`${p(['홍대', '동묘', '광장', '서교'])}구제`);
    case 'shoes': return la(`${p(EN)} ${p(['Shoes', 'Sneakers'])}`);
    case 'mart': return ko(`${p(K_SHOP)}${p(['마트', '슈퍼', '식자재마트', '할인마트'])}`);
    case 'gift': return r.chance(0.5) ? la(`${p(EN)} ${p(['Shop', 'Object', 'Goods'])}`) : ko(`${p(KO_SOFT)} 소품샵`);
    case 'stationery': return ko(`${p(K_SHOP)}${p(['문구', '문구센터', '팬시'])}`);
    case 'books': return r.chance(0.5) ? ko(`책방 ${p(KO_SOFT)}`) : la(`${p(EN)} Books`);
    case 'music': return ko(`${p(TR_FUN)}${p(['악기', '뮤직', '기타'])}`);
    case 'liquor': return la(`${p(EN)} ${p(['Wine', 'Bottle Shop', 'Liquor'])}`);
    case 'tattoo': return la(`${p(EN)} ${p(['Tattoo', 'Ink'])}`);
    case 'laundry': return ko(r.chance(0.6) ? `${p(K_SHOP)}${p(['세탁', '세탁소'])}` : `${tr(r)[1]} 코인빨래방`);
    case 'phone': return ko(`${p(TR_FUN)}${p(['모바일', '텔레콤', '폰'])}`);
    case 'church': return ko(`${p(['홍대', '서교', '사랑의', '은혜', '새생명', '소망'])}교회`);
    case 'bank': return ko(`${p(['새봄', '한울', '누리'])}은행`);
    default: return ko(`${p(K_SHOP)}상회`);
  }
}

// Short names for projecting signs and tenant directories.
const SHORT = {
  restaurant: ['식당', '한식', '기사식당'], korean: ['국밥', '해장국'], baekban: ['백반'], gukbap: ['국밥'], snack: ['분식', '김밥'], tteokbokki: ['떡볶이'],
  chicken: ['치킨', '통닭'], bbq: ['고기', '삼겹살', '갈비', '곱창'], hof: ['호프', '생맥주'], pocha: ['포차'], bar: ['BAR', 'PUB'], club: ['CLUB'],
  karaoke: ['노래방', '노래연습장'], coinkaraoke: ['코인노래방'], pc: ['PC방', 'PC'], billiards: ['당구장', '당구클럽'], arcade: ['오락실', '게임장'],
  roomcafe: ['룸카페'], manga: ['만화카페'], boardgame: ['보드게임'], escape: ['방탈출'], hair: ['헤어', '미용실'], nail: ['네일'], cafe: ['CAFE', '카페', 'COFFEE'],
  clinic: ['내과', '의원', '피부과', '한의원', '정형외과'], dentist: ['치과'], pharmacy: ['약국'], realestate: ['부동산'], academy: ['학원', '수학', '영어'],
  music_academy: ['실용음악', '보컬', '댄스'], pilates: ['필라테스', '요가', '헬스'], studio: ['스튜디오', '연습실'], hotel: ['HOTEL', '모텔'], photo: ['사진관'],
  massage: ['마사지'], laundry: ['세탁'], mart: ['마트', '슈퍼'],
};

export function shortName(cat, r) {
  const pre = {
    karaoke: TR_FUN, coinkaraoke: TR_FUN, pc: TR_FUN, billiards: TR_FUN, arcade: TR_FUN, hair: TR.map((t) => t[1]), nail: TR.map((t) => t[1]),
    clinic: K_MED, dentist: K_MED, pharmacy: K_MED, realestate: K_SHOP, academy: ACADEMY, mart: K_SHOP, laundry: K_SHOP,
  }[cat];
  const w = r.pick(SHORT[cat] || SHORT.restaurant);
  if (pre && !isLatin(w) && r.chance(0.6)) {
    const p = r.pick(pre);
    if ([...(p + w)].length <= 6) return p + w;
  }
  return w;
}

// ---------------------------------------------------------------- fonts
export const FONTS = {
  gothic: ['900 Noto Sans KR', '900 Gothic A1', '800 Gothic A1', 'Black Han Sans', 'Do Hyeon', '700 Noto Sans KR'],
  headline: ['Black Han Sans', 'Do Hyeon', '900 Noto Sans KR', '900 Gothic A1'],
  round: ['Jua', '700 Sunflower', '700 Dongle', 'Gowun Dodum'],
  serif: ['900 Noto Serif KR', 'Song Myung', '800 Nanum Myeongjo', '700 Gowun Batang', '800 Hahmlet'],
  brush: ['Nanum Brush Script', 'East Sea Dokdo', 'Yeon Sung', 'Dokdo'],
  hand: ['Nanum Pen Script', '700 Gaegu', 'Hi Melody'],
  retro: ['Gugi', 'Orbit'],
  enBold: ['Bebas Neue', '700 Oswald', 'Anton', 'Archivo Black', '800 Montserrat', 'Bungee'],
  enScript: ['Pacifico', 'Lobster', 'Great Vibes'],
  enSerif: ['700 Playfair Display', 'Abril Fatface', '500 Playfair Display'],
  enNeon: ['Monoton', 'Righteous', 'Pacifico', 'Permanent Marker', 'Lobster'],
  enMin: ['500 Montserrat', '300 Oswald', '400 Playfair Display', '600 Montserrat'],
  jaBrush: ['Yuji Syuku', 'Yuji Boku'],
  jaMincho: ['800 Shippori Mincho', '900 Noto Serif JP', 'Zen Antique'],
  jaGothic: ['900 Noto Sans JP', 'Dela Gothic One', 'RocknRoll One', 'Kosugi Maru'],
  zhT: ['900 Noto Serif TC', '700 LXGW WenKai TC', '900 Noto Sans TC'],
  zhS: ['Ma Shan Zheng', 'ZCOOL XiaoWei', '900 Noto Serif SC'],
  th: ['700 Kanit', 'Sriracha', '700 Noto Sans Thai'],
};
export const EMOJI = 'Noto Emoji';
// Fallback chain per script (glyphs missing from a display font).
export const FALLBACK = {
  ko: ['Noto Sans KR'],
  latin: ['Noto Sans KR'],
  ja: ['Noto Sans JP', 'Noto Sans KR'],
  zhT: ['Noto Serif TC', 'Noto Sans KR'],
  zhS: ['Noto Serif SC', 'Noto Sans KR'],
  th: ['Noto Sans Thai', 'Noto Sans KR'],
};

// Korean font families per vibe (weights of groups).
const VIBE_FONTS = {
  trad: [['gothic', 35], ['headline', 15], ['brush', 30], ['serif', 20]],
  snack: [['headline', 45], ['gothic', 25], ['round', 25], ['brush', 5]],
  night: [['headline', 45], ['gothic', 35], ['retro', 20]],
  pro: [['gothic', 80], ['serif', 12], ['headline', 8]],
  beauty: [['serif', 40], ['gothic', 40], ['round', 20]],
  cafe: [['round', 30], ['serif', 30], ['hand', 25], ['gothic', 15]],
  latin: [['gothic', 70], ['serif', 30]],
};

function weighted(r, list) {
  const total = list.reduce((s, x) => s + x[1], 0);
  let v = r() * total;
  for (const [k, w] of list) if ((v -= w) < 0) return k;
  return list[0][0];
}

function koFont(r, vibe) {
  return r.pick(FONTS[weighted(r, VIBE_FONTS[vibe] || VIBE_FONTS.pro)]);
}
function latinFont(r, vibe) {
  if (vibe === 'cafe' || vibe === 'beauty') return r.pick(FONTS[weighted(r, [['enSerif', 35], ['enMin', 30], ['enScript', 25], ['enBold', 10]])]);
  return r.pick(FONTS[weighted(r, [['enBold', 50], ['enSerif', 20], ['enMin', 20], ['enScript', 10]])]);
}

// ---------------------------------------------------------------- colors
const FLEX = [
  ['#D7191C', '#FFFFFF', '#FFE14D'], ['#B5121B', '#FFE14D', '#FFFFFF'], ['#FFD200', '#C8102E', '#111111'],
  ['#FFD200', '#111111', '#C8102E'], ['#00843D', '#FFFFFF', '#FFE14D'], ['#0055A5', '#FFFFFF', '#FFE14D'],
  ['#1B2A5B', '#FFFFFF', '#F5C518'], ['#111111', '#FFD200', '#FFFFFF'], ['#111111', '#FFFFFF', '#E8272C'],
  ['#F5F5F0', '#C8102E', '#1B2A5B'], ['#F5F5F0', '#0055A5', '#D7191C'], ['#F5F5F0', '#111111', '#00843D'],
  ['#F07F1A', '#FFFFFF', '#5A2A0A'], ['#6B3E26', '#F3E6C4', '#FFD200'], ['#009B9B', '#FFFFFF', '#FFE14D'],
  ['#7A1F2B', '#F3E6C4', '#FFD200'], ['#F3E6C4', '#6B3E26', '#B5121B'], ['#2E7D32', '#FFF8E1', '#FFCA28'], ['#FFFFFF', '#E65100', '#4E342E'],
];
const NIGHT = [
  ['#1B2A5B', '#FFFFFF', '#F5C518'], ['#111111', '#FFD200', '#FFFFFF'], ['#6A2C91', '#FFFFFF', '#FFD200'], ['#D7191C', '#FFFFFF', '#FFE14D'],
  ['#0055A5', '#FFFFFF', '#FFE14D'], ['#E85A9B', '#FFFFFF', '#5B1A3A'], ['#263238', '#80DEEA', '#FFFFFF'], ['#009B9B', '#FFFFFF', '#FFE14D'],
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
  fascia: {
    trad: [['flex', 70], ['galva', 20], ['channel', 10]],
    snack: [['flex', 80], ['channel', 20]],
    night: [['flex', 60], ['channel', 25], ['neon', 15]],
    pro: [['flex', 78], ['channel', 14], ['galva', 8]],
    beauty: [['galva', 35], ['channel', 40], ['flex', 25]],
    cafe: [['galva', 40], ['channel', 40], ['flex', 15], ['neon', 5]],
    latin: [['galva', 35], ['channel', 35], ['neon', 15], ['flex', 15]],
  },
  upper: {
    trad: [['flex', 60], ['sheet', 40]],
    snack: [['flex', 60], ['sheet', 40]],
    night: [['flex', 50], ['sheet', 40], ['neon', 10]],
    pro: [['sheet', 55], ['flex', 40], ['channel', 5]],
    beauty: [['sheet', 45], ['channel', 35], ['flex', 20]],
    cafe: [['sheet', 40], ['channel', 40], ['galva', 20]],
    latin: [['sheet', 35], ['channel', 35], ['neon', 15], ['galva', 15]],
  },
};

const SUBS_KO = ['포장 · 배달', '24시', '연중무휴', '홍대점', '본점', '2호점', '단체석 완비', '예약 환영', '주차 가능'];

function emblemFor(icon, pal) {
  const eb = pal[2] && pal[2] !== pal[0] ? pal[2] : '#FFFFFF';
  return { glyph: icon, bg: eb, ring: pal[1] === eb ? pal[0] : pal[1] };
}

export function makeDesign(req, index) {
  const r = rng(req.s ^ (index * 2654435761));
  const kind = req.k;
  const cat = req.c === 'brand' ? 'brand' : CAT[req.c] ? req.c : 'restaurant';
  const info = CAT[cat] || CAT.restaurant;
  const d = { i: index, kind, cat, w: req.w, h: req.h, sub: [], emblem: null, off: 0, box: null, fb: 'ko' };

  if (kind === 'board') return boardDesign(req, r, d);
  if (kind === 'banner') return bannerDesign(r, d);
  if (kind === 'stack') return stackDesign(req, r, d);
  if (kind === 'exit') {
    // Generic metro exit sign (no operator logo): number tile + 출구.
    Object.assign(d, { style: 'exit', text: `${req.t} 출구`, no: req.t, glow: 'face', box: { color: '#2A2E36', depth: 0.12 } });
    return d;
  }
  if (cat === 'brand') return brandDesign(req, r, d);
  if (kind === 'vert') return vertDesign(r, d, info.v, null);

  const nm = makeName(cat, r);
  d.text = nm.sub ? `${nm.main} ${nm.sub}` : nm.main;
  d.fb = nm.script;
  const icon = info.i.length ? r.pick(info.i) : null;
  const menu = info.m.length ? r.pick(info.m) : null;
  const upper = kind === 'upper';

  // Foreign-origin shops follow their own sign traditions.
  if (nm.flavor === 'ja') return japaneseDesign(r, d, nm, icon, upper);
  if (nm.flavor === 'zhk') return koChineseDesign(r, d, nm, menu, upper);
  if (nm.flavor === 'zh') return chineseDesign(r, d, nm, upper);
  if (['vi', 'th', 'it', 'fr', 'mx'].includes(nm.flavor)) return worldDesign(r, d, nm, icon, upper);

  const latin = nm.script === 'latin';
  // Latin-named shops in Korean trades (e.g. a hair salon) keep their trade's look.
  const vibe = latin && !['night', 'trad', 'snack', 'pro', 'beauty', 'cafe'].includes(info.v) ? 'latin' : info.v;
  const style = weighted(r, (STYLE_W[upper ? 'upper' : 'fascia'][vibe]) || STYLE_W.fascia.pro);
  d.style = style;
  const mainFont = latin ? latinFont(r, vibe) : koFont(r, info.v);

  if (style === 'flex') {
    const pal = r.pick(info.v === 'pro' ? PRO : info.v === 'night' ? NIGHT : FLEX);
    d.bg = { type: weighted(r, [['solid', 50], ['vgrad', 25], ['band', 25]]), c1: pal[0], c2: r.chance(0.5) ? shade(pal[0], 0.78) : pal[2] };
    d.main = { text: nm.main, font: mainFont, color: pal[1], stroke: r.chance(0.3) ? shade(pal[0], 0.45) : null, shadow: r.chance(0.25) };
    if (icon && r.chance(info.v === 'pro' ? 0.35 : 0.5)) d.emblem = emblemFor(icon, pal);
    const subs = [nm.sub || menu || r.pick(SUBS_KO), r.chance(0.6) ? phone(r) : r.pick(SUBS_KO)];
    const n = r.chance(0.75) ? (r.chance(0.5) ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) d.sub.push({ text: subs[k], color: k === 0 ? pal[1] : pal[2] === pal[0] ? pal[1] : pal[2], font: r.pick(['700 Noto Sans KR', '500 Noto Sans KR', '700 Gothic A1']) });
    d.layout = r.pick(['right', 'below', 'right', 'band']);
    d.box = { color: r.chance(0.5) ? BOX_ALU : shade(pal[0], 0.55), depth: upper ? 0.16 : 0.22 };
    d.glow = 'face';
  } else if (style === 'galva') {
    const pal = r.pick(GALVA);
    d.bg = { type: 'solid', c1: pal[0] };
    d.main = { text: nm.main, font: mainFont, color: pal[1], metal: r.chance(0.5), spacing: latin ? r.int(2, 10) : r.int(0, 4) };
    const sub = nm.sub || (latin ? r.pick(['since ' + r.int(1998, 2023), 'EST. ' + r.int(2005, 2023), menu || '']) : menu);
    if (sub && r.chance(0.6)) d.sub.push({ text: sub, color: pal[1], font: isLatin(sub) ? r.pick(FONTS.enMin) : '500 Noto Sans KR', spacing: 4 });
    d.layout = r.pick(['below', 'center', 'center']);
    d.box = { color: pal[0], depth: 0.06 };
    d.glow = r.chance(0.35) ? 'letters' : 'none';
  } else if (style === 'channel') {
    const col = r.pick(CHANNEL);
    d.bg = { type: 'none' };
    d.main = { text: nm.main, font: mainFont, color: col, ret: shade(col === '#111111' ? '#555555' : col, 0.5) };
    d.raceway = r.chance(0.55) ? r.pick(['#2B2B2B', '#8A8F94', '#D9D4C7', shade(col, 0.4)]) : null;
    if (nm.sub && r.chance(0.5)) d.sub.push({ text: nm.sub, color: col, font: isLatin(nm.sub) ? r.pick(FONTS.enMin) : '700 Noto Sans KR' });
    d.layout = d.sub.length ? 'below' : 'center';
    d.off = 0.14;
    d.glow = 'letters';
  } else if (style === 'neon') {
    const tube = r.pick(NEON);
    d.bg = r.chance(0.6) ? { type: 'solid', c1: r.pick(['#0B0B10', '#111317', '#1A0E14', '#0E1418']) } : { type: 'none' };
    d.main = { text: nm.main, font: latin ? r.pick(FONTS.enNeon) : r.pick([...FONTS.round, ...FONTS.headline]), color: tube, neon: true };
    if (latin && r.chance(0.4)) d.sub.push({ text: r.pick(['OPEN', 'BAR', 'LIVE', 'PUB']), color: r.pick(NEON), font: r.pick(FONTS.enNeon), neon: true });
    d.layout = 'center';
    d.box = d.bg.type === 'none' ? null : { color: d.bg.c1, depth: 0.05 };
    d.off = d.bg.type === 'none' ? 0.16 : 0.08;
    d.glow = 'letters';
  } else {
    // Window lettering (cut vinyl) on upper floors.
    const col = r.pick(SHEET);
    d.bg = { type: 'none' };
    d.main = { text: nm.main, font: latin ? r.pick(FONTS.enBold) : r.pick([...FONTS.gothic, ...FONTS.headline]), color: col, stroke: r.chance(0.4) ? '#1A1A1A' : null };
    if (r.chance(0.75)) d.sub.push({ text: r.chance(0.6) ? phone(r) : menu || phone(r), color: r.chance(0.5) ? col : '#FFFFFF', font: r.pick(['700 Noto Sans KR', 'Do Hyeon', 'Black Han Sans']) });
    if (r.chance(0.35)) d.floorTag = { text: `${(req.f || 1) + 1}F`, color: col };
    d.layout = r.pick(['below', 'right']);
    d.off = 0.22;
    d.glow = 'none';
  }
  return d;
}

// Japanese restaurants: dark noren-style boards with white brush lettering,
// natural wood boards with black brush, or red-on-white ramen boards; the
// Korean reading goes underneath in small type.
function japaneseDesign(r, d, nm, icon, upper) {
  const look = r.pick(['noren', 'wood', 'white', 'noren']);
  const pal = { noren: ['#1E2A44', '#F4EFE6', '#C8102E'], wood: ['#C9A46A', '#1A1410', '#8A1C1C'], white: ['#F4F1EA', '#B5121B', '#111111'] }[look];
  d.style = upper || look === 'white' ? 'flex' : 'galva';
  d.bg = { type: look === 'wood' ? 'wood' : look === 'noren' ? 'noren' : 'band', c1: pal[0], c2: pal[2] };
  d.main = { text: nm.main, font: r.pick(look === 'white' ? [...FONTS.jaGothic, ...FONTS.jaBrush] : [...FONTS.jaBrush, ...FONTS.jaMincho]), color: pal[1] };
  d.sub.push({ text: nm.sub, color: pal[1], font: r.pick(['700 Noto Sans KR', '700 Noto Serif KR']) });
  if (icon && r.chance(0.5)) d.emblem = { glyph: icon === '🍣' || icon === '🍜' ? icon : '🍶', bg: '#B5121B', ring: '#F4EFE6' };
  d.layout = 'below';
  d.fb = 'ja';
  d.box = { color: look === 'wood' ? '#5A3E22' : shade(pal[0], 0.6), depth: d.style === 'galva' ? 0.08 : 0.2 };
  d.glow = d.style === 'galva' ? (r.chance(0.5) ? 'letters' : 'none') : 'face';
  return d;
}

// Korean-Chinese restaurants: red or yellow boards, Korean name with the
// hanja name beside or below, gold rules.
function koChineseDesign(r, d, nm, menu, upper) {
  const pal = r.pick([['#B5121B', '#FFD34D', '#FFD34D'], ['#B5121B', '#FFFFFF', '#FFD34D'], ['#FFD200', '#B5121B', '#B5121B'], ['#111111', '#FFD34D', '#B5121B']]);
  d.style = 'flex';
  d.bg = { type: 'band', c1: pal[0], c2: pal[2] };
  const hanjaBig = r.chance(0.35);
  d.main = { text: hanjaBig ? nm.sub : nm.main, font: hanjaBig ? r.pick(FONTS.zhT) : r.pick([...FONTS.headline, ...FONTS.serif]), color: pal[1], stroke: r.chance(0.3) ? shade(pal[0], 0.45) : null };
  d.fb = hanjaBig ? 'zhT' : 'ko';
  d.sub.push({ text: hanjaBig ? nm.main : nm.sub, color: pal[1], font: hanjaBig ? '700 Noto Sans KR' : r.pick(FONTS.zhT), fb: hanjaBig ? 'ko' : 'zhT' });
  if (menu && r.chance(0.6)) d.sub.push({ text: menu, color: pal[1], font: '700 Noto Sans KR' });
  d.layout = r.pick(['right', 'below']);
  d.box = { color: shade(pal[0], 0.55), depth: upper ? 0.16 : 0.22 };
  d.glow = 'face';
  return d;
}

// Chinese-run mala / skewer shops: simplified characters dominate.
function chineseDesign(r, d, nm, upper) {
  const pal = r.pick([['#C8102E', '#FFE14D', '#111111'], ['#111111', '#FF3B30', '#FFD34D'], ['#FFD200', '#C8102E', '#111111']]);
  d.style = 'flex';
  d.bg = { type: r.chance(0.5) ? 'band' : 'solid', c1: pal[0], c2: pal[2] };
  d.main = { text: nm.main, font: r.pick(FONTS.zhS), color: pal[1] };
  d.sub.push({ text: nm.sub, color: pal[1], font: '900 Noto Sans KR' });
  d.layout = 'right';
  d.fb = 'zhS';
  d.box = { color: shade(pal[0], 0.55), depth: upper ? 0.16 : 0.22 };
  d.glow = 'face';
  return d;
}

// Vietnamese, Thai, Italian, French, Mexican: their own script and colours.
function worldDesign(r, d, nm, icon, upper) {
  const P = {
    vi: [['#0F6B3A', '#FFE14D', '#C8102E'], ['#FFF6E0', '#0F6B3A', '#C8102E']],
    th: [['#5B2C83', '#FFD34D', '#FFFFFF'], ['#1F4E3D', '#F5D27A', '#FFFFFF']],
    it: [['#F7F3EA', '#1F5E3B', '#C8102E'], ['#1F5E3B', '#F7F3EA', '#C8102E']],
    fr: [['#1F2A44', '#F3E6C4', '#C9A46A'], ['#F3E6C4', '#1F2A44', '#C9A46A']],
    mx: [['#FFB000', '#C8102E', '#00897B'], ['#00897B', '#FFFFFF', '#FFB000']],
  }[nm.flavor];
  const pal = r.pick(P);
  d.style = upper ? 'flex' : r.chance(0.5) ? 'flex' : 'galva';
  d.bg = { type: d.style === 'flex' ? r.pick(['band', 'solid']) : 'solid', c1: pal[0], c2: pal[2] };
  let font;
  if (nm.script === 'th') font = r.pick(FONTS.th);
  else if (nm.script === 'ko') font = r.pick(FONTS.headline);
  else if (nm.flavor === 'mx') font = r.pick(['Bungee', 'Lobster', 'Righteous']);
  else if (nm.flavor === 'vi') font = r.pick(['700 Montserrat', 'Lobster', '700 Playfair Display']);
  else font = r.pick([...FONTS.enSerif, ...FONTS.enScript]);
  d.main = { text: nm.main, font, color: pal[1] };
  d.sub.push({ text: nm.sub, color: pal[1], font: /[฀-๿]/.test(nm.sub) ? '700 Kanit' : '700 Noto Sans KR', fb: /[฀-๿]/.test(nm.sub) ? 'th' : 'ko' });
  if (icon && r.chance(0.4)) d.emblem = emblemFor(icon, pal);
  d.layout = 'below';
  d.box = { color: shade(pal[0], 0.55), depth: d.style === 'galva' ? 0.06 : 0.2 };
  d.glow = d.style === 'galva' ? 'letters' : 'face';
  return d;
}

// Real chains (parody names). Foreign brands keep their Latin-script look.
function brandDesign(req, r, d) {
  if (d.kind === 'vert') return vertDesign(r, d, 'night', req);
  const lat = BRAND_LATIN[req.t];
  const main = lat ? lat[0] : req.t;
  d.text = lat ? `${main} ${req.t}` : req.t;
  d.style = 'flex';
  d.bg = { type: r.chance(0.3) ? 'vgrad' : 'solid', c1: req.bg, c2: shade(req.bg, 0.8) };
  d.main = { text: main, font: isLatin(main) ? r.pick(['Archivo Black', '800 Montserrat', 'Anton']) : r.pick(['Black Han Sans', '900 Noto Sans KR']), color: req.fg, spacing: isLatin(main) ? 2 : 0 };
  const sub = lat && lat[1] ? lat[1] : r.chance(0.5) ? r.pick(['홍대점', '홍대입구역점', '24시']) : null;
  if (sub) d.sub.push({ text: sub, color: req.fg, font: isLatin(sub) ? '600 Montserrat' : '700 Noto Sans KR', spacing: isLatin(sub) ? 6 : 0 });
  d.layout = sub ? 'below' : 'center';
  d.box = { color: shade(req.bg, 0.6), depth: 0.22 };
  d.glow = 'face';
  return d;
}

function vertDesign(r, d, vibe, brandReq) {
  d.style = 'vflex';
  const text = brandReq ? (BRAND_LATIN[brandReq.t]?.[0] ?? brandReq.t) : shortName(d.cat, r);
  d.text = text;
  const pal = brandReq ? [brandReq.bg, brandReq.fg, '#FFFFFF'] : r.pick(vibe === 'pro' ? PRO : vibe === 'night' ? NIGHT : FLEX);
  d.bg = { type: weighted(r, [['solid', 55], ['blocks', 25], ['vgrad', 20]]), c1: pal[0], c2: brandReq ? shade(pal[0], 0.7) : r.chance(0.5) ? pal[2] : shade(pal[0], 0.7) };
  d.main = { text, font: isLatin(text) ? r.pick(FONTS.enBold) : r.pick(FONTS[weighted(r, [['headline', 50], ['gothic', 35], ['serif', 15]])]), color: pal[1], stroke: r.chance(0.25) ? shade(pal[0], 0.45) : null };
  const info = CAT[d.cat];
  if (!brandReq && info && info.i.length && r.chance(0.4)) d.emblem = { glyph: r.pick(info.i), bg: '#FFFFFF', ring: pal[1] === '#FFFFFF' ? pal[0] : pal[1] };
  if (r.chance(0.25)) d.sub.push({ text: r.pick(['24시', '2F', '3F', 'B1']), color: pal[2] === pal[0] ? pal[1] : pal[2], font: '900 Noto Sans KR' });
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
    const pal = rr.pick(info.v === 'pro' ? PRO : NIGHT.concat(FLEX));
    return {
      text: name, floor: `${k + 2}F`, bg: pal[0], fg: pal[1], acc: pal[2],
      font: isLatin(name) ? rr.pick(FONTS.enBold) : rr.pick(FONTS[weighted(rr, [['headline', 45], ['gothic', 45], ['serif', 10]])]),
    };
  }).reverse();
  d.box = { color: r.pick(['#D9DCDF', BOX_ALU, '#2B2E33']), depth: 0.3 };
  d.glow = 'face';
  return d;
}

function boardDesign(req, r, d) {
  d.style = 'board';
  const lat = BRAND_LATIN[req.t];
  const main = lat ? lat[0] : req.t;
  d.text = lat ? `${main} ${req.t}` : req.t;
  d.bg = { type: 'vgrad', c1: req.bg, c2: shade(req.bg, 0.6) };
  d.main = { text: main, font: isLatin(main) ? r.pick(['Archivo Black', 'Anton', '900 Montserrat']) : r.pick(['Black Han Sans', '900 Noto Sans KR', 'Do Hyeon']), color: req.fg };
  d.sub.push({ text: r.pick(['새로운 맛의 시작', '지금 만나보세요', '오늘도 함께', '더 가까이, 더 새롭게', 'NEW OPEN', '언제 어디서나']), color: req.fg, font: '700 Noto Sans KR' });
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
  d.glow = 'none';
  return d;
}

export const DENSITY = { fascia: 56, vert: 56, stack: 46, upper: 44, banner: 40, board: 30, exit: 72 };
