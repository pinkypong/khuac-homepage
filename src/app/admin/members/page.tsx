import { createClient } from "@/lib/supabase/server";
import { approveMember, rejectMember } from "./actions";

export default async function AdminMembersPage() {
  const supabase = await createClient();
  const { data: pendingMembers, error } = await supabase
    .from("members")
    .select("id, auth_user_id, name, email, joined_at, invite:invites!invited_via(label)")
    .eq("role", "pending")
    .order("joined_at", { ascending: true });

  if (error) {
    // requireAdminSession also runs inside the actions, but middleware already
    // keeps non-admins out of /admin/*; a query error here means something
    // else broke, not a permissions issue.
    throw error;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">가입 승인 대기</h1>

      {pendingMembers.length === 0 ? (
        <p className="text-sm text-neutral-500">대기 중인 가입 신청이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pendingMembers.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-4 rounded border border-neutral-200 px-4 py-3"
            >
              <div>
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-neutral-500">{member.email}</p>
                <p className="text-xs text-neutral-400">
                  신청일: {new Date(member.joined_at).toLocaleDateString("ko-KR")}
                </p>
                {member.invite?.[0]?.label && (
                  <p className="text-xs text-neutral-400">
                    초대 경로: {member.invite[0].label}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
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
    </main>
  );
}
