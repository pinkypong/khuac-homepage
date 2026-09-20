import { describe, expect, it } from "vitest";
import { groupRoutePins, type NamedPoint } from "./route-pins";

const p = (name: string, lat: number, lng: number): NamedPoint => ({ name, lat, lng });

describe("groupRoutePins", () => {
  it("leaves an ordinary point-to-point course untouched", () => {
    // 밤골 → 숨은벽 → 백운대 → 도선사: nothing revisited, nothing to fold.
    const pins = groupRoutePins([
      p("밤골", 37.665, 126.977),
      p("숨은벽능선", 37.660, 126.975),
      p("백운대", 37.659, 126.975),
      p("도선사", 37.665, 126.984),
    ]);
    expect(pins).toHaveLength(4);
    expect(pins.every((pin) => pin.leg === "outbound")).toBe(true);
  });

  it("folds a loop's shared trailhead into one pin", () => {
    // 덕산온천 loop: starts and ends at the same spot under the same name.
    const trailhead = p("덕산온천", 36.679, 126.598);
    const pins = groupRoutePins([
      trailhead,
      p("일락사", 36.685, 126.605),
      p("개심사", 36.690, 126.612),
      { ...trailhead },
    ]);
    expect(pins).toHaveLength(3);
    const merged = pins.find((pin) => pin.points.length > 1);
    expect(merged?.points.map((point) => point.name)).toEqual(["덕산온천", "덕산온천"]);
    expect(merged?.leg).toBe("outbound");
  });

  it("folds a gate renamed between the way up and the way down", () => {
    // 백운봉암문 and 위문 are one gate, 340m apart is too far - here they sit
    // on the same coordinate, which is the case this exists for.
    const gate = { lat: 37.6613, lng: 126.9765 };
    const pins = groupRoutePins([
      p("밤골", 37.665, 126.977),
      { name: "백운봉암문", ...gate },
      p("백운대", 37.6588, 126.9754),
      { name: "위문", ...gate },
      p("밤골", 37.665, 126.977),
    ]);
    // The gate folds to one pin; the trailhead, visited twice, folds to
    // another. Three pins: trailhead, gate, summit.
    expect(pins).toHaveLength(3);
  });

  it("marks a real retrace's second half as the way back", () => {
    const pins = groupRoutePins([
      p("치인리", 35.812, 128.115),
      p("용탑선원", 35.815, 128.117),
      p("정상", 35.820, 128.120),
      p("용탑선원", 35.815, 128.117),
      p("치인리", 35.812, 128.115),
    ]);
    expect(pins).toHaveLength(3);
    const byName = new Map(pins.map((pin) => [pin.points[0].name, pin]));
    expect(byName.get("치인리")?.leg).toBe("outbound");
    expect(byName.get("용탑선원")?.leg).toBe("outbound");
    expect(byName.get("정상")?.leg).toBe("outbound");
  });

  it("keeps two different endpoints apart", () => {
    const pins = groupRoutePins([p("밤골", 37.665, 126.977), p("도선사", 37.665, 126.984)]);
    expect(pins).toHaveLength(2);
  });

  it("handles a single point", () => {
    expect(groupRoutePins([p("관악산", 37.442, 126.964)])).toHaveLength(1);
  });

  it("handles no points", () => {
    expect(groupRoutePins([])).toHaveLength(0);
  });
});
