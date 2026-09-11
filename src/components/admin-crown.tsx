/**
 * The 운영진 marker. A bare emoji reads as decoration to a screen reader, so it
 * carries its own label and says the word the crown is standing in for.
 */
export function AdminCrown({ className = "" }: { className?: string }) {
  return (
    <span role="img" aria-label="관리자" title="관리자" className={"shrink-0 " + className}>
      👑
    </span>
  );
}
