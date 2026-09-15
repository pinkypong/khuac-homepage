import { describe, expect, it } from "vitest";
import { classifyQuery, extractTimeframe, isRouteQuestion, weatherSubject } from "./intent";

describe("classifyQuery", () => {
  it("routes a bare location question without calling anything", () => {
    expect(classifyQuery("인수봉 위치")).toBe("location");
    expect(classifyQuery("북한산 어디야")).toBe("location");
  });

  it("routes a bare weather question", () => {
    expect(classifyQuery("인수봉 오늘 날씨")).toBe("weather");
    expect(classifyQuery("이번 주말 비 와?")).toBe("weather");
  });

  it("routes anything asking for judgment to the model", () => {
    expect(classifyQuery("이번 주말 날씨 고려해서 초보자가 갈 만한 루트 추천해줘")).toBe(
      "complex",
    );
    expect(classifyQuery("관악산이랑 북한산 중에 어디가 나아")).toBe("complex");
  });

  it("fails open to complex on a query it does not recognise", () => {
    expect(classifyQuery("ㅋㅋㅋ 안녕")).toBe("complex");
  });

  it("prefers complex when a query mixes a lookup word with a judgment word", () => {
    // "날씨" alone would be "weather", but "고려해서 추천" makes this a judgment
    // call, and getting that wrong here is the one mistake this module exists
    // to avoid.
    expect(classifyQuery("날씨 고려해서 추천해줘")).toBe("complex");
  });
});

describe("isRouteQuestion", () => {
  it("recognises a question asking for named routes", () => {
    expect(isRouteQuestion("관악산 등산루트")).toBe(true);
    expect(isRouteQuestion("초보자에게 괜찮은 코스 추천해줘")).toBe(true);
  });

  it("is false for a question that never mentions a route", () => {
    expect(isRouteQuestion("관악산이랑 북한산 중에 어디가 나아")).toBe(false);
  });
});

describe("extractTimeframe", () => {
  it("recognises each supported word", () => {
    expect(extractTimeframe("오늘 날씨")).toBe("today");
    expect(extractTimeframe("내일 갈 수 있어?")).toBe("tomorrow");
    expect(extractTimeframe("이번 주말 날씨")).toBe("this_weekend");
    expect(extractTimeframe("다음주에 가려는데")).toBe("next_week");
  });

  it("defaults to unspecified rather than guessing", () => {
    expect(extractTimeframe("인수봉 날씨")).toBe("unspecified");
  });
});

it.each(["관악산 등산 루트", "관악산 등산 루트 추천해줘", "관악산 초보자가 가기 좋은 코스 있어?", "3시간 정도 걸리는 관악산 등산 추천해줘"])("recognises natural route requests: %s", (question) => {
  expect(classifyQuery(question)).toBe("complex");
  expect(isRouteQuestion(question)).toBe(true);
});

describe("weatherSubject", () => {
  it("leaves the mountain name once the weather words are gone", () => {
    expect(weatherSubject("이번주 청계산 날씨")).toBe("청계산");
    expect(weatherSubject("오늘 관악산 날씨 알려줘")).toBe("관악산");
    expect(weatherSubject("내일 도봉산 기온")).toBe("도봉산");
    expect(weatherSubject("청계산 날씨 어때")).toBe("청계산");
  });

  // "이번 주" is a prefix of "이번 주말"; stripping the short one first used
  // to leave "말 북한산".
  it("handles a compound time phrase without stranding a syllable", () => {
    expect(weatherSubject("이번 주말 북한산 날씨")).toBe("북한산");
    expect(weatherSubject("이번주말 북한산 날씨")).toBe("북한산");
  });

  // Removing "가" anywhere would turn 가리산 into 리산.
  it("keeps a name that starts with a particle-like syllable", () => {
    expect(weatherSubject("가리산 날씨")).toBe("가리산");
    expect(weatherSubject("이번주 가리산 날씨")).toBe("가리산");
  });

  it("trims a trailing particle but not the name", () => {
    expect(weatherSubject("북한산의 날씨")).toBe("북한산");
  });

  it("returns null when no place was named", () => {
    expect(weatherSubject("이번주 날씨")).toBeNull();
    expect(weatherSubject("날씨")).toBeNull();
  });
});

it.each(["북한산 이번주 날씨", "북한산 이번 주 날씨", "북한산 금주 날씨"])("recognizes this week: %s", q => {
 expect(extractTimeframe(q)).toBe("this_week");
});

describe("어프로치", () => {
  it("reads an approach as a route, because that is what it is", () => {
    expect(isRouteQuestion("인수봉 고독길 어프로치")).toBe(true);
    expect(isRouteQuestion("선인봉 접근로 알려줘")).toBe(true);
    expect(isRouteQuestion("숨은벽 들머리")).toBe(true);
    expect(isRouteQuestion("백운대 하산로")).toBe(true);
  });

  it("still leaves a question that is not asking for one alone", () => {
    expect(isRouteQuestion("인수봉 오늘 날씨")).toBe(false);
  });
});

describe("등산 as a word, not as a syllable", () => {
  it("does not read a gear question as a request for courses", () => {
    // Both contain 등산 and 추천, and neither is asking where to walk.
    expect(isRouteQuestion("등산화 추천해줘")).toBe(false);
    expect(isRouteQuestion("등산복 추천")).toBe(false);
    expect(isRouteQuestion("등산스틱 추천해줘")).toBe(false);
  });

  it("still reads a real one", () => {
    expect(isRouteQuestion("북한산 등산 추천해줘")).toBe(true);
    expect(isRouteQuestion("초보 산행 추천")).toBe(true);
    expect(isRouteQuestion("관악산 등산로")).toBe(true);
  });
});
