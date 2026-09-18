/**
 * Displays only the crest area of the official source image.
 * The bitmap stays unchanged; the nested SVG viewport excludes all lettering.
 * A square field avoids mixing a round seal with a rectangular crop.
 */
export function ClubCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={`club-crest ${className}`} viewBox="0 0 64 64" role="img" aria-label="경희대학교 산악부 산 문장">
      <rect x="1" y="1" width="62" height="62" rx="2" fill="#5b1119" />
      <svg x="7" y="9" width="50" height="46" viewBox="65 25 110 92" overflow="hidden">
        <image href="/khuac-crest-source.png" width="238" height="241" />
      </svg>
    </svg>
  );
}
