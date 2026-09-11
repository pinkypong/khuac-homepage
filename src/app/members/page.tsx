import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminCrown } from "@/components/admin-crown";
import type { MemberRole } from "@/types/database";

interface RosterRow {
  id: string;
  name: string | null;
  role: MemberRole;
  joined_at: string;
}

export default async function MembersPage() {
  const supabase = await createClient();

  // member_names, not members: the roster needs names and roles, and the
  // members table itself stays unreadable because it also holds email.
  const { data, error } = await supabase
    .from("member_names")
    .select("id, name, role, joined_at")
    .in("role", ["admin", "member"]);
  if (error) throw error;

  const rows = (data ?? []) as RosterRow[];
  // 운영진 first, then by name. Sorted here rather than in the query because
  // Postgres would order Korean names by byte value, not by 가나다.
  const members = [...rows].sort((a, b) => {
    if ((a.role === "admin") !== (b.role === "admin")) return a.role === "admin" ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "ko");
  });
  const adminCount = members.filter((m) => m.role === "admin").length;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <Link href="/map" className="inline-block py-1 text-sm text-neutral-500 underline">
        ← 지도로
      </Link>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">부원</h1>
        <p className="text-sm text-neutral-500">
          {members.length}명
          {adminCount > 0 && ` · 운영진 ${adminCount}명`}
        </p>
      </div>

      {members.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">아직 승인된 부원이 없습니다.</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {member.name || "이름 없음"}
              </span>
              {member.role === "admin" && <AdminCrown />}
              <span className="shrink-0 text-xs text-neutral-400">
                {new Date(member.joined_at).toLocaleDateString("ko-KR")} 가입
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
