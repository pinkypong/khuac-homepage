"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeMember } from "./actions";

/**
 * A client button rather than a plain form action: removing someone is
 * irreversible and deserves a confirm, and the server's refusal to let an admin
 * remove themselves has to land somewhere a person can read.
 */
export function RemoveMemberButton({
  authUserId,
  name,
}: {
  authUserId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove() {
    const message =
      `'${name}'님을 방출하시겠습니까?\n\n` +
      "계정이 삭제되어 다시 가입해야 합니다.\n" +
      "올린 사진과 댓글은 남고, 이름만 '알 수 없음'으로 바뀝니다.";
    if (!window.confirm(message)) return;

    setPending(true);
    try {
      await removeMember(authUserId);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "방출에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "처리 중…" : "방출"}
    </button>
  );
}
