import { createClient } from "@/lib/supabase/server";
import { AdminCrown } from "@/components/admin-crown";
import type { MemberRole } from "@/types/database";
import { approveMember, rejectMember } from "./actions";
import { RemoveMemberButton } from "./remove-member-button";

interface MemberRow {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  role: MemberRole;
  joined_at: string;
}

export default async function AdminMembersPage() {
  const supabase = await createClient();
  // members_select lets an admin read every row, so one query covers both
  // lists - the queue and the roster differ only by role.
  const { data, error } = await supabase
    .from("members")
    .select("id, auth_user_id, name, email, role, joined_at")
    .order("joined_at", { ascending: true });
  if (error) {
    // requireAdminSession also runs inside the actions, but middleware already
    // keeps non-admins out of /admin/*; a query error here means something
    // else broke, not a permissions issue.
    throw error;
  }
  const rows = data as unknown as MemberRow[];
  const pendingMembers = rows.filter((m) => m.role === "pending");
  const approvedMembers = rows
    .filter((m) => m.role === "member" || m.role === "admin")
    .sort((a, b) => {
      if ((a.role === "admin") !== (b.role === "admin")) return a.role === "admin" ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });

  // Used to hide 방출 on your own row; the action refuses it server-side too,
  // so this is a display detail and getSession's cookie read is enough - no
  // need to spend a round trip revalidating the token with the auth server.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const viewerAuthId = session?.user.id;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:py-10">
      <h1 className="mb-6 text-xl font-semibold">가입 승인 대기</h1>

      {pendingMembers.length === 0 ? (
        <p className="text-sm text-neutral-500">대기 중인 가입 신청이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pendingMembers.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-3 rounded border border-neutral-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{member.name}</p>
                <p className="break-all text-sm text-neutral-500">{member.email}</p>
                <p className="text-xs text-neutral-400">
                  신청일: {new Date(member.joined_at).toLocaleDateString("ko-KR")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={approveMember.bind(null, member.id)}>
                  <button
                    type="submit"
                    className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    승인
                  </button>
                </form>
                <form action={rejectMember.bind(null, member.auth_user_id)}>
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    거절
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-10 text-xl font-semibold">부원 {approvedMembers.length}명</h2>
      <p className="mb-4 text-xs text-neutral-500">
        방출하면 계정이 삭제되어 다시 가입해야 합니다. 올린 사진과 댓글은 남습니다.
      </p>

      <ul className="flex flex-col gap-3">
        {approvedMembers.map((member) => (
          <li
            key={member.id}
            className="flex flex-col gap-3 rounded border border-neutral-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                {member.name}
                {member.role === "admin" && <AdminCrown />}
              </p>
              <p className="break-all text-sm text-neutral-500">{member.email}</p>
              <p className="text-xs text-neutral-400">
                가입일: {new Date(member.joined_at).toLocaleDateString("ko-KR")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {member.auth_user_id === viewerAuthId ? (
                <span className="self-center text-xs text-neutral-400">본인</span>
              ) : (
                <RemoveMemberButton authUserId={member.auth_user_id} name={member.name} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
