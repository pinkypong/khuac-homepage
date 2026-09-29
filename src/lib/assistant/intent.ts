/**
 * Routes a question before any model is called.
 *
 * "인수봉 위치" and "인수봉 오늘 날씨" have exact answers sitting in our own DB
 * and a free weather API - asking an LLM to fetch and relay them adds cost,
 * latency and a chance of getting a number wrong for no benefit. Gemini is
 * worth its cost only once a question asks for judgment: a recommendation, a
 * comparison, "괜찮을까" rather than "몇 도야".
 *
 * This is a cost optimisation, not a correctness boundary, and it is built to
 * fail toward Gemini rather than away from it: a query this misses as
 * "complex" still gets a correct answer, just at Gemini's price. A query this
 * wrongly calls "simple" would return an incomplete answer with no chance to
 * recover, so every list below is kept narrow and a query touching both a
 * simple topic and a judgment word is routed as complex.
 */
export type QueryIntent = "location" | "weather" | "complex";

// Any of these turns a query complex regardless of what else it contains -
// recommending, comparing, or judging suitability needs synthesis, not a
// lookup. "위치랑 날씨 다 알려줘" asks for two lookups glued together, which
// this list does not catch on purpose: routing it as complex costs one extra
// call and still produces a correct combined answer.
const JUDGMENT_WORDS = [
  "추천",
  "루트",
  "코스",
  "초보",
  "초심자",
  "숙련",
  "난이도",
  "비교",
  "얼마나",
  "몇 시간",
  "갈만",
  "갈 만",
  "괜찮",
  "가도",
  "가볼",
  "가볼만",
  "도전",
  "준비물",
  "챙겨",
  "챙길",
  "계획",
  "어떤",
  "어디가",
  "vs",
];

const WEATHER_WORDS = ["날씨", "기온", "온도", "비 와", "비와", "눈 와", "눈와", "바람", "강수"];

const LOCATION_WORDS = ["위치", "어디", "좌표", "지도"];

function containsAny(query: string, words: string[]): boolean {
  return words.some((word) => query.includes(word));
}

export function classifyQuery(query: string): QueryIntent {
  if (isRouteQuestion(query) || containsAny(query, JUDGMENT_WORDS)) return "complex";
  if (containsAny(query, WEATHER_WORDS)) return "weather";
  if (containsAny(query, LOCATION_WORDS)) return "location";
  // An unrecognised shape is exactly where a wrong guess would hurt most, so
  // it goes to the model that can actually read it.
  return "complex";
}

// 어프로치 is the walk in to the foot of a climb, and it is a route by every
// measure that matters here: named places in an order, on real paths, with a
// length. This club's own card advertises 어프로치 next to 코스추천, and yet
// "인수봉 고독길 어프로치" answered with prose and no cards, because the word
// was not on this list - so there was nothing to put on the map and nothing to
// make an album from. 접근로 and 들머리 are the same thing said differently,
// and 하산로 is it in reverse.
const ROUTE_WORDS = [
  "루트", "코스", "능선", "등산로", "등산길", "산행길", "경로",
  "어프로치", "접근로", "들머리", "하산로",
];

/**
 * A complex question that is specifically asking for named routes, as opposed
 * to a comparison or a general "괜찮을까" - this decides whether to spend the
 * extra grounded search call on real, current course names or answer with a
 * plain narrative instead.
 */
export function isRouteQuestion(query: string): boolean {
  if (containsAny(query, ROUTE_WORDS)) return true;
  // "등산 추천" is asking for somewhere to walk. "등산화 추천" is asking for
  // boots, and it was reaching the same twenty-seven-second search for named
  // courses because both contain 등산 and 추천. The word only counts when it
  // stands on its own: anything that carries straight on into another syllable
  // - 등산화, 등산복, 등산스틱, 산행기 - is a different noun. Compounds that
  // really are routes (등산로, 등산길, 산행길) are on the list above already.
  //
  // 산 standing alone counts for the same reason, and its absence was the gap
  // that sent "널널하게 이번주 토요일에 갈만한 산 추천" to prose with nothing
  // to tap onto the map: a member asking where to go names the walk as often
  // as the walking. It needs the guard on both sides rather than just the
  // right - 등산화 and 산악부 are caught by one each, and 부산·울산·아산 are
  // cities that happen to end in it.
  //
  // A named mountain is not read from its shape - 북한산 and 부산 have the
  // same one. That is isNamedMountainRouteQuestion's job, against the names the
  // library holds.
  const walking = /(등산|산행)(?![가-힣])/.test(query)
    || /(?<![가-힣])산(?![가-힣])/.test(query);
  return walking && containsAny(query, ASKING);
}

// What a member says when they want somewhere to go rather than a fact about it.
const ASKING = ["추천", "초보", "시간", "갈 만", "갈만"];

// A question that names a mountain and asks for a recommendation is still not
// asking for a walk when it is also about something else: 북한산 맛집 추천 and
// 관악산 등산화 추천 each name a mountain and want no course.
const ABOUT_SOMETHING_ELSE = [
  "맛집", "식당", "카페", "숙소", "숙박", "펜션", "민박", "주차", "장비",
  "등산화", "등산복", "스틱", "배낭", "가격", "영업", "근처", "주변",
];

// Library names that are also a town: 안산 and 오산 are cities, 금산 a county,
// 경주 the city its national park is named for. "안산 맛집" is caught above, but
// "안산 추천" is not, and buying a course search for a town is the mistake this
// list exists to avoid. Members who mean the mountain say 등산, 코스 or 산 too,
// and those already count.
const ALSO_A_TOWN = new Set(["경주", "안산", "오산", "금산"]);

// What may follow a name and still be that name: nothing, or a particle. 남산타워
// and 북한산성 carry straight on into another noun.
const PARTICLES = "이가은는을를에의도로과와만쪽";

function standsAlone(query: string, name: string): boolean {
  for (let at = query.indexOf(name); at !== -1; at = query.indexOf(name, at + 1)) {
    const before = query[at - 1];
    const after = query[at + name.length];
    if (before && /[가-힣]/.test(before)) continue;
    if (after && /[가-힣]/.test(after) && !PARTICLES.includes(after)) continue;
    return true;
  }
  return false;
}

/** Whether the member is asking for somewhere to go, whatever they name. */
export function asksForSomewhere(query: string): boolean {
  return containsAny(query, ASKING) && !containsAny(query, ABOUT_SOMETHING_ELSE);
}

/**
 * "북한산 추천": a route question, told from "부산 맛집 추천" by whether the
 * name is one the library holds - which is knowledge no pattern has.
 *
 * Exactly one mountain. Two names is a comparison, and cards for whichever the
 * library happened to pick would answer half of it and hide that a choice was
 * made. A name inside a longer matched one (북한산 in 북한산 원효봉) is the same
 * mountain, not a second.
 */
export function isNamedMountainRouteQuestion(query: string, mountains: readonly string[]): boolean {
  if (!asksForSomewhere(query)) return false;
  const named = mountains.filter(
    (name) => name.length >= 2 && !ALSO_A_TOWN.has(name) && standsAlone(query, name),
  );
  const distinct = named.filter((name) => !named.some((other) => other !== name && other.includes(name)));
  return new Set(distinct).size === 1;
}

// Everything a weather question is built from apart from the place itself.
// Stripping these leaves the name to look up: "이번주 청계산 날씨" -> "청계산".
//
// Sorted longest-first, which is load-bearing: "이번 주" is a prefix of
// "이번 주말", and removing the shorter one first left "말" stranded in front
// of the mountain.
//
// Single-character particles are deliberately absent. Removing "가" anywhere
// turns 가리산 into 리산, so they are trimmed from the end of the result
// instead, where they can only be particles.
const WEATHER_FILLER = [
  ...WEATHER_WORDS,
  "이번 주말", "이번주말", "다음 주말", "다음주말",
  "이번주", "이번 주", "이번", "금주", "다음주", "다음 주", "담주",
  "오늘", "내일", "모레", "당일", "주말", "토요일", "일요일", "토욜", "일욜",
  "알려줘", "알려", "어때", "어떤가", "확인", "좀",
].sort((a, b) => b.length - a.length);

const TRAILING_PARTICLE = /(의|은|는|이|가|에서|에)$/;

/**
 * The place a weather question is about, or null when it names none.
 *
 * Subtraction rather than extraction: there is no list of Korean mountains to
 * match against, but there is a short, closed list of the words a weather
 * question is otherwise made of. Whatever survives is the name - which is
 * then looked up, so a wrong guess fails visibly at the lookup rather than
 * silently answering about somewhere else.
 */
export function weatherSubject(query: string): string | null {
  let rest = query;
  for (const word of WEATHER_FILLER) rest = rest.split(word).join(" ");
  const subject = rest.replace(/\s+/g, " ").trim().replace(TRAILING_PARTICLE, "");
  // One stray character is noise, not a place name.
  return subject.length >= 2 ? subject : null;
}

// In a climbing club "등반" means rock, not walking uphill - a member asking
// for 불암산 등반루트 wants the crag's routes, and answering with the four
// hiking trails to the summit is answering a different question. "등산",
// "산행" and "트레킹" stay on the hiking side.
const CLIMBING_WORDS = [
  // 어프로치 is the walk in to the foot of a climb. It is only ever said about
  // climbing - a hiker says 들머리 - so a course that carries the word is a
  // climb's approach however much of it is spent walking uphill.
  "등반", "암벽", "릿지", "리지", "슬랩", "크랙", "멀티피치", "볼더링",
  "암장", "빙벽", "퀵드로우", "확보물", "클라이밍", "개념도", "토포", "어프로치",
];

/** Whether the question is about climbing rather than hiking. */
export function isClimbingQuestion(query: string): boolean {
  return containsAny(query, CLIMBING_WORDS);
}

export type TimeframeWord = "today" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "unspecified";

/**
 * A word match, not date arithmetic - resolveTimeframe in the weather module
 * turns the result into actual dates against the real clock. This only has to
 * recognise which word was used.
 */
export function extractTimeframe(query: string): TimeframeWord {
  if (containsAny(query, ["오늘", "당일"])) return "today";
  if (containsAny(query, ["내일"])) return "tomorrow";
  if (containsAny(query, ["주말", "토요일", "일요일", "토욜", "일욜"])) return "this_weekend";
  if (containsAny(query, ["다음주", "다음 주", "담주"])) return "next_week";
  if (containsAny(query, ["이번주", "이번 주", "금주"])) return "this_week";
  return "unspecified";
}
