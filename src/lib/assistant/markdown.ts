/**
 * A deliberately small Markdown reader for one job: Gemini answers.
 *
 * The model writes `**굵게**`, `##` headings and `*` bullets whatever the
 * prompt asks, and rendering that string raw put the symbols on screen. Rather
 * than fight the model or pull in a Markdown library (and a sanitiser with
 * it), the few constructs it actually emits are turned into blocks the panel
 * renders with real weight and size.
 *
 * Anything unrecognised keeps its text and loses only the punctuation, so a
 * new construct degrades to a clean paragraph rather than to visible syntax.
 */

export interface InlineToken {
  text: string;
  bold: boolean;
}

export type Block =
  | { kind: "heading"; content: InlineToken[] }
  | { kind: "paragraph"; content: InlineToken[] }
  | { kind: "list"; ordered: boolean; start?: number; items: InlineToken[][] }
  | { kind: "table"; header: InlineToken[][]; rows: InlineToken[][][] }
  | { kind: "rule" };

const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
// A row of a Markdown table: at least one pipe with something either side.
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
// The ---|---|--- line under a table header, which carries no content.
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
// A thematic break the model uses between courses.
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;

/** One table row split into cells, with the outer pipes dropped. */
function splitRow(line: string): InlineToken[][] {
  const inner = TABLE_ROW.exec(line);
  return (inner ? inner[1] : line).split("|").map((cell) => parseInline(cell.trim()));
}

/**
 * Splits on `**bold**`, dropping the markers. Single asterisks are stripped
 * rather than italicised: the model uses them for emphasis and for bullets
 * interchangeably, and a stray one should never reach the screen.
 */
export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index;
    if (index > last) tokens.push({ text: source.slice(last, index), bold: false });
    tokens.push({ text: match[1], bold: true });
    last = index + match[0].length;
  }
  if (last < source.length) tokens.push({ text: source.slice(last), bold: false });

  return tokens
    .map((token) => ({ ...token, text: token.text.replace(/\*/g, "").replace(/\s+/g, " ") }))
    .filter((token) => token.text.trim().length > 0 || token.text === " ");
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  // Held open so consecutive bullets join one list instead of each becoming
  // its own, which is what decides whether they share a bullet column.
  let list: { ordered: boolean; start?: number; items: InlineToken[][] } | null = null;
  let table: { header: InlineToken[][]; rows: InlineToken[][][] } | null = null;
  let paragraph: string[] = [];

  function closeParagraph() {
    if (paragraph.length === 0) return;
    const content = parseInline(paragraph.join(" "));
    if (content.length > 0) blocks.push({ kind: "paragraph", content });
    paragraph = [];
  }

  function closeTable() {
    if (!table) return;
    blocks.push({ kind: "table", header: table.header, rows: table.rows });
    table = null;
  }

  function closeList() {
    if (!list) return;
    if (list.items.length > 0) blocks.push({ kind: "list", ordered: list.ordered, start: list.start, items: list.items });
    list = null;
  }

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      closeParagraph();
      closeTable();
      continue;
    }

    // Tables first: a divider row is all dashes and pipes, which would
    // otherwise be read as a bullet or a rule and reach the screen as
    // ----|----|. That was exactly how comparison tables used to render.
    if (TABLE_ROW.test(line)) {
      closeParagraph();
      closeList();
      if (TABLE_DIVIDER.test(line)) {
        // Carries no content - it only marks the row above as the header.
        if (table && table.rows.length === 0) continue;
      }
      const cells = splitRow(line);
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    if (RULE.test(line)) {
      closeParagraph();
      closeList();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const content = parseInline(heading[1]);
      if (content.length > 0) blocks.push({ kind: "heading", content });
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    if (ordered || bullet) {
      closeParagraph();
      const isOrdered = ordered !== null;
      // A switch between bullet and number starts a new list: they are two
      // different lists that happen to touch.
      if (list && list.ordered !== isOrdered) closeList();
      if (!list) list = { ordered: isOrdered, start: ordered ? Number(ordered[1]) : undefined, items: [] };
      const content = parseInline(ordered ? ordered[2] : bullet![1]);
      if (content.length > 0) list.items.push(content);
      continue;
    }

    // An indented line under a bullet continues that bullet rather than
    // starting a paragraph in the middle of the list.
    if (list && /^\s+/.test(raw) && list.items.length > 0) {
      list.items[list.items.length - 1].push(...parseInline(" " + line.trim()));
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  closeParagraph();
  closeList();
  closeTable();
  return blocks;
}
