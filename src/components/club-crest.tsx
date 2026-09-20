/**
 * The club's mountain emblem on its burgundy field.
 *
 * The emblem is drawn from khuac-emblem.png, which is an alpha mask - white
 * where the mark is, transparent everywhere else - so the burgundy comes from
 * the rect below it rather than from the bitmap. That is the whole reason the
 * mark is clean now.
 *
 * It used to crop the emblem out of the full logo (khuac-crest-source.png)
 * with a nested SVG viewport, burgundy field and all. That bitmap is a
 * screenshot of a screenshot: 11,322 distinct colours in a two-colour mark,
 * with 1.18% of its pixels neither burgundy, white, nor a blend of the two -
 * compression noise, which at 64px reads as white grit scattered over the
 * field. Measured again after the mask was built: 255 colours, 0% grit.
 *
 * The mask was made by thresholding luminance (the field sits near 42, the
 * mark at 255, so a ramp between 95 and 165 lands in open space between them)
 * and dropping connected blobs under 6px, which removed four specks. Edge
 * pixels keep their partial alpha, so the mark stays smooth rather than
 * stair-stepped.
 */
export function ClubCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={`club-crest ${className}`} viewBox="0 0 64 64" role="img" aria-label="경희대학교 산악부 산 문장">
      <rect width="64" height="64" fill="#5b1119" />
      {/* Same box the cropped version occupied, so this is a drop-in swap:
          96x81 fitted into 50x46 renders 50x42.2, centred, leaving an even
          ~11 above and below and 7 either side. */}
      <image
        href="/khuac-emblem.png"
        x="7"
        y="9"
        width="50"
        height="46"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}
