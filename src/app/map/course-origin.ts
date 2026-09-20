/**
 * Where a course came from, said plainly on screen.
 *
 * The rank in `@/lib/assistant/origin` decides which row wins when two describe
 * the same course. This decides what a member is told about the one they are
 * looking at - which nothing did, so a 산림청 survey and a web answer looked
 * identical in the list.
 *
 * That gap had a cost. Two approach courses carried a waypoint called 비둘기샘,
 * invented by a grounded search: the club's words are 비둘기길, a route, and
 * 비둘기하강, a rappel, and neither is a point on the walk in. Nobody could have
 * caught it from the screen, because the screen did not say the line had come
 * from a search in the first place. A member who climbs 인수봉 spots it in a
 * second once told where it came from - so telling them is the cheapest
 * correction this data has.
 */
export interface OriginLabel {
  /** Short enough to sit on a row beside the course name. */
  text: string;
  /** Said on hover, and to a screen reader. */
  hint: string;
  /** True for sources nobody has checked - drawn in amber rather than grey. */
  unverified: boolean;
}

const LABELS: Record<string, OriginLabel> = {
  gpx: { text: "GPX", hint: "부원이 실제로 걸으며 기록한 트랙", unverified: false },
  knps: { text: "국립공원공단", hint: "국립공원공단이 측량한 코스", unverified: false },
  club: { text: "부원 기록", hint: "부원이 직접 적은 코스", unverified: false },
  forest: { text: "산림청", hint: "산림청 등산로 정보에서 가져온 코스", unverified: false },
  search: {
    text: "웹 검색 · 확인 필요",
    hint: "AI 웹 검색 결과이며 아직 아무도 확인하지 않았습니다. 틀린 곳이 있으면 수정해주세요.",
    unverified: true,
  },
};

/**
 * An origin nobody listed is treated as a search result, matching `rankOf`.
 * Saying nothing would be the one answer that leaves a member no wiser than
 * before, and the honest reading of "we do not know where this came from" is
 * that it has not been checked.
 */
export function originLabel(origin: string | null | undefined): OriginLabel {
  return LABELS[origin ?? "search"] ?? LABELS.search;
}
