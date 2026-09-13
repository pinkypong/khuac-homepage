import { describe, expect, it } from "vitest";
import { classifyQuery, extractTimeframe, isRouteQuestion } from "./intent";

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
