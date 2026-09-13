import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, type Block } from "./markdown";

const plain = (blocks: Block[]) =>
  blocks.map((block) =>
    block.kind === "list"
      ? block.items.map((item) => item.map((t) => t.text).join(""))
      : block.kind === "table"
        ? [...block.header, ...block.rows.flat()].map((cell) => cell.map((t) => t.text).join(""))
        : block.kind === "rule"
          ? []
          : block.content.map((t) => t.text).join(""),
  );

/** Every piece of text a reader would actually see, joined. */
const rendered = (source: string) =>
  parseMarkdown(source)
    .flatMap((block) =>
      block.kind === "list"
        ? block.items.flat()
        : block.kind === "table"
          ? [...block.header, ...block.rows.flat()].flat()
          : block.kind === "rule"
            ? []
            : block.content,
    )
    .map((token) => token.text)
    .join("");

describe("parseInline", () => {
  it("turns **text** into bold tokens without the markers", () => {
    expect(parseInline("들머리: **연주대**입니다")).toEqual([
      { text: "들머리: ", bold: false },
      { text: "연주대", bold: true },
      { text: "입니다", bold: false },
    ]);
  });

  it("strips stray asterisks rather than showing them", () => {
    expect(parseInline("*연주대* 정상").map((t) => t.text).join("")).toBe("연주대 정상");
  });
});

describe("parseMarkdown", () => {
  it("reads a heading without its hashes", () => {
    expect(parseMarkdown("## 관악산 코스")).toEqual([
      { kind: "heading", content: [{ text: "관악산 코스", bold: false }] },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    const blocks = parseMarkdown("* 첫째\n* 둘째");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(plain(blocks)[0]).toEqual(["첫째", "둘째"]);
  });

  it("separates a numbered list from a bulleted one", () => {
    const blocks = parseMarkdown("1. 하나\n- 둘");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list"]);
    expect(blocks[0]).toMatchObject({ ordered: true });
    expect(blocks[1]).toMatchObject({ ordered: false });
  });

  it("attaches an indented continuation to the bullet above it", () => {
    const blocks = parseMarkdown("* 사당역 코스\n    들머리: 사당역 4번 출구");
    expect(plain(blocks)[0]).toEqual(["사당역 코스 들머리: 사당역 4번 출구"]);
  });

  it("keeps a blank line as a block break", () => {
    expect(parseMarkdown("첫 문단\n\n둘째 문단").map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("never leaves markdown punctuation in the output", () => {
    const source = "## 제목\n\n1. **서울대 입구 코스**\n   * 들머리: 관악산공원\n\n일반 문장 *강조* 포함";
    expect(rendered(source)).not.toMatch(/[#*]/);
  });
});

describe("tables and rules", () => {
  it("reads a comparison table instead of printing its divider", () => {
    const blocks = parseMarkdown("| 코스 | 거리 |\n|------|------|\n| 사당능선 | 3.8km |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table.kind !== "table") throw new Error("expected a table");
    expect(table.header.map((c) => c.map((t) => t.text).join(""))).toEqual(["코스", "거리"]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].map((c) => c.map((t) => t.text).join(""))).toEqual(["사당능선", "3.8km"]);
  });

  // The bug this whole block exists for: the divider row reached the screen
  // as ----|----| because nothing recognised it.
  it("never leaves pipes or divider dashes in rendered text", () => {
    const text = rendered("| 코스 | 거리 |\n|:-----|-----:|\n| A | 1km |");
    expect(text).not.toMatch(/\|/);
    expect(text).not.toMatch(/---/);
  });

  it("treats a thematic break as a rule, not as text", () => {
    expect(parseMarkdown("첫 문단\n\n---\n\n둘째 문단").map((b) => b.kind)).toEqual([
      "paragraph",
      "rule",
      "paragraph",
    ]);
  });

  it("does not mistake a bullet or a heading for a rule", () => {
    expect(parseMarkdown("* 항목").map((b) => b.kind)).toEqual(["list"]);
    expect(parseMarkdown("- 항목").map((b) => b.kind)).toEqual(["list"]);
  });

  it("keeps a table that follows prose separate from it", () => {
    expect(parseMarkdown("비교표입니다.\n| A | B |\n|---|---|\n| 1 | 2 |").map((b) => b.kind)).toEqual([
      "paragraph",
      "table",
    ]);
  });
});

it("continues numbering across blank lines", () => {
 const blocks = parseMarkdown("1. 첫째\n\n1. 둘째");
 expect(blocks).toHaveLength(1);
 expect(blocks[0]).toMatchObject({ kind: "list", ordered: true, start: 1 });
 if (blocks[0].kind === "list") expect(blocks[0].items).toHaveLength(2);
});
it("preserves numbering after descriptions", () => {
 const blocks = parseMarkdown("1. 첫째\n- 설명\n\n2. 둘째");
 expect(blocks.filter(b => b.kind === "list" && b.ordered).map(b => b.kind === "list" ? b.start : null)).toEqual([1, 2]);
});
