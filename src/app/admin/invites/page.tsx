import { createClient } from "@/lib/supabase/server";
import { CopyLinkButton } from "@/components/copy-link-button";
import { createInvite, revokeInvite } from "./actions";

export default async function AdminInvitesPage() {
  const supabase = await createClient();
  const { data: invites, error } = await supabase
    .from("invites")
    .select("id, token, label, max_uses, used_count, expires_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">초대 링크</h1>
      <p className="mb-6 text-sm text-neutral-500">
        여기서 만든 링크를 카카오톡/밴드로 공유하면, 그 링크로 가입한 사람은 가입 승인 화면에
        어떤 초대로 들어왔는지 표시됩니다. 승인 절차 자체는 그대로 필요합니다.
      </p>

      <form
        action={createInvite}
        className="mb-8 flex flex-col gap-3 rounded border border-neutral-200 p-4"
      >
        <input
          name="label"
          placeholder="메모 (예: 카카오톡 신입방)"
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-3">
          <input
            name="maxUses"
            type="number"
            min="1"
            placeholder="최대 사용 횟수 (비우면 무제한)"
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            name="expiresAt"
            type="date"
            aria-label="만료일 (선택)"
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          초대 링크 만들기
        </button>
      </form>

      {invites.length === 0 ? (
        <p className="text-sm text-neutral-500">발급된 초대 링크가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invites.map((invite) => {
            const isExpired = invite.expires_at ? new Date(invite.expires_at) < new Date() : false;
            const isExhausted =
              invite.max_uses !== null && invite.used_count >= invite.max_uses;
            const isRevoked = invite.revoked_at !== null;
            const isDead = isExpired || isExhausted || isRevoked;

            return (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-4 rounded border border-neutral-200 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{invite.label || "(메모 없음)"}</p>
                  <p className="text-xs text-neutral-400">
                    사용 {invite.used_count}
                    {invite.max_uses !== null ? ` / ${invite.max_uses}` : ""}
                    {invite.expires_at &&
                      ` · ${new Date(invite.expires_at).toLocaleDateString("ko-KR")}까지`}
                    {isRevoked && " · 취소됨"}
                    {isExpired && !isRevoked && " · 만료됨"}
                    {isExhausted && !isRevoked && !isExpired && " · 소진됨"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!isDead && <CopyLinkButton path={`/join/${invite.token}`} />}
                  {!isRevoked && (
                    <form action={revokeInvite.bind(null, invite.id)}>
                      <button
                        type="submit"
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        취소
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
