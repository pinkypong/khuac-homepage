import { SignOutButton } from "@/components/sign-out-button";

export default function PendingApprovalPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">관리자 승인 대기 중입니다</h1>
      <p className="text-sm text-neutral-600">
        가입 신청이 접수되었습니다. 운영진 승인 후 이용하실 수 있습니다.
      </p>
      <SignOutButton />
    </main>
  );
}
