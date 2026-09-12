import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { NameForm } from "@/app/account/name-form";
import { PendingWatcher } from "./pending-watcher";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  // Reaching this page at all means the middleware already checked the session
  // and found an unapproved member, so the id here is just the key to that
  // member's own row - which RLS would restrict to them regardless.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data } = await supabase
    .from("members")
    .select("name")
    .eq("auth_user_id", session.user.id)
    .single();
  const name = (data as { name: string | null } | null)?.name ?? "";

  return (
    <main className="mx-auto flex min-h-app max-w-sm flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <PendingWatcher />

      <h1 className="text-xl font-semibold">관리자 승인 대기 중입니다</h1>
      <p className="text-sm text-neutral-600">
        가입 신청이 접수되었습니다. 승인되면 이 화면에서 자동으로 넘어갑니다.
      </p>

      {/* Asked for here rather than after approval: this is the name the admin
          reads in the queue when deciding who this actually is, and a member
          waiting on approval has nothing else to do with the screen. */}
      <NameForm initialName={name} />

      <SignOutButton />
    </main>
  );
}
