"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyName } from "./actions";
import { MAX_NAME_LENGTH } from "./name";
import { AdminCrown } from "@/components/admin-crown";

/**
 * Nobody is ever asked for a name when they sign up: Google hands over whatever
 * its profile says and a magic link leaves only the part of the address before
 * the @, so members arrive called things like "hhp". Both mount points below
 * exist to let them fix that - one while they wait for approval, one afterwards.
 */
function useRename(initialName: string) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (draft.trim() === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setName(await updateMyName(draft));
      setEditing(false);
      router.refresh();
    } catch (err) {
      // The input stays open holding what was typed, so a failure is retryable.
      setError(err instanceof Error ? err.message : "이름 변경에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return { name, draft, setDraft, editing, saving, error, start, cancel, save };
}

/** The waiting room's version: always open, because the name is the whole point. */
export function NameForm({ initialName }: { initialName: string }) {
  const { draft, setDraft, saving, error, save } = useRename(initialName);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="w-full rounded-lg border border-neutral-200 p-3 text-left"
    >
      <label htmlFor="member-name" className="block text-xs font-medium">
        이름
      </label>
      <p className="mt-0.5 text-[11px] text-neutral-500">
        운영진이 이 이름을 보고 승인합니다. 승인 후에는 사진과 댓글에 붙습니다.
      </p>
      <div className="mt-2 flex gap-1.5">
        <input
          id="member-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          disabled={saving}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-base disabled:opacity-50 md:text-sm"
        />
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </form>
  );
}

/** The map header's version: a name you can click, in the space it already sat. */
export function ViewerName({
  initialName,
  isAdmin = false,
}: {
  initialName: string;
  isAdmin?: boolean;
}) {
  const { name, draft, setDraft, editing, saving, error, start, cancel, save } =
    useRename(initialName);

  if (!editing) {
    return (
      <span className="flex items-center gap-1">
        {isAdmin && <AdminCrown />}
        <button
          type="button"
          onClick={start}
          title="이름 수정"
          className="text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          {name}
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
        maxLength={MAX_NAME_LENGTH}
        disabled={saving}
        autoFocus
        aria-label="이름"
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        className={
          "w-28 rounded border px-1.5 py-1 text-base disabled:opacity-50 md:py-0.5 md:text-xs " +
          (error ? "border-red-400" : "border-neutral-300")
        }
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || !draft.trim()}
        className="shrink-0 rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50 md:px-1.5 md:py-0.5 md:text-[11px]"
      >
        저장
      </button>
      <button
        type="button"
        onClick={cancel}
        className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 md:px-1.5 md:py-0.5 md:text-[11px]"
      >
        취소
      </button>
    </span>
  );
}
