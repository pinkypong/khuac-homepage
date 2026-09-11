import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex items-center gap-4 border-b border-neutral-200 px-4 py-3 text-sm">
        {/* The admin screens are a side trip off the map, which is the app
            itself - without this the only way back is the browser's own back
            button, and there is none at all on a phone in standalone mode. */}
        <Link
          href="/map"
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          ← 지도로
        </Link>
        <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
        <Link href="/admin/members" className="hover:underline">
          가입 승인
        </Link>
        <Link href="/admin/photos/unmatched" className="hover:underline">
          위치 매칭 대기
        </Link>
      </nav>
      {children}
    </div>
  );
}
