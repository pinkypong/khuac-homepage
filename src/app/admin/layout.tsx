import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PendingBadge } from "@/components/pending-badge";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Middleware already keeps non-admins out of /admin/*, so this always runs
  // with an admin's read of members.
  const supabase = await createClient();
  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("role", "pending");

  return (
    <div className="pb-[env(safe-area-inset-bottom)]">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-sm">
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
        <Link href="/admin/members" className="flex items-center gap-1 hover:underline">
          가입 승인
          <PendingBadge count={count ?? 0} />
        </Link>
        <Link href="/admin/photos/unmatched" className="hover:underline">
          위치 매칭 대기
        </Link>
      </nav>
      {children}
    </div>
  );
}
