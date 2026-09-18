/**
 * Displays only the crest area of the official source image.
 * The bitmap stays unchanged; the nested SVG viewport excludes all lettering.
 *
 * The burgundy field runs to the edge of the viewBox. It used to be a rounded
 * rect inset by a pixel, which left a hairline of the page showing all the way
 * round it and a wedge of it in each corner - white against the header, and
 * read as the mark being dirty rather than as a deliberate border.
 *
 * UNFINISHED. White still shows inside the mark itself, and that is the source
 * bitmap rather than anything this file does: khuac-crest-source.png carries
 * an opaque white page behind the seal, so every edge the emblem is
 * anti-aliased against is blended towards white rather than towards the
 * burgundy it sits on. Cropping cannot remove it and keying it out would eat
 * the emblem, which is white. A replacement image is coming from the club -
 * ideally the emblem alone on transparency, or on the same #5b1119 - and this
 * is finished when that lands. Do not spend more geometry on it until then.
 */
export function ClubCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={`club-crest ${className}`} viewBox="0 0 64 64" role="img" aria-label="경희대학교 산악부 산 문장">
      <rect width="64" height="64" fill="#5b1119" />
      <svg x="7" y="9" width="50" height="46" viewBox="65 25 110 92" overflow="hidden">
        <image href="/khuac-crest-source.png" width="238" height="241" />
      </svg>
    </svg>
  );
}
