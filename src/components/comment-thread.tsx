"use client";

import { useCallback, useEffect, useState } from "react";
import { addComment, deleteComment, editComment, loadComments } from "@/app/map/comment-actions";
import { COMMENT_MAX_LENGTH, type CommentSubject, type CommentView } from "@/app/map/comments";
import { AdminCrown } from "@/components/admin-crown";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Recent comments read better as "3분 전"; anything past a week is more useful
// as a date, since "9일 전" makes the reader do the arithmetic.
function formatWhen(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < MINUTE) return "방금";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}분 전`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Loads and renders one subject's comments, fetching on mount rather than
 * taking them as props - see loadComments for why photo comments are not
 * preloaded with the map tree.
 *
 * The subject arrives as two scalars rather than one object so the effect
 * below re-runs on an actual subject change, not on every re-render of a
 * freshly built object literal.
 */
export function CommentThread({
  subjectKind,
  subjectId,
}: {
  subjectKind: CommentSubject["kind"];
  subjectId: string;
}) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; isAdmin: boolean } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    setLoadError(null);
    setEditing(null);
    loadComments({ kind: subjectKind, id: subjectId })
      .then((data) => {
        // Arrowing through photos quickly can land an older response last.
        if (cancelled) return;
        setComments(data.comments);
        setViewer({ id: data.viewerId, isAdmin: data.viewerIsAdmin });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(message(err, "댓글을 불러오지 못했습니다."));
      });
    return () => {
      cancelled = true;
    };
  }, [subjectKind, subjectId]);

  const submit = useCallback(async () => {
    if (submitting || !draft.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await addComment({ kind: subjectKind, id: subjectId }, draft);
      setComments((prev) => [...(prev ?? []), created]);
      setDraft("");
    } catch (err) {
      // The draft stays in the box so a failed submit can be retried as typed.
      setFormError(message(err, "댓글 등록에 실패했습니다."));
    } finally {
      setSubmitting(false);
    }
  }, [draft, subjectKind, subjectId, submitting]);

  async function saveEdit() {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const updated = await editComment(editing.id, editing.body);
      setComments((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
      setEditing(null);
    } catch (err) {
      window.alert(message(err, "댓글 수정에 실패했습니다."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("이 댓글을 삭제할까요?")) return;
    setBusyId(id);
    try {
      await deleteComment(id);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch (err) {
      window.alert(message(err, "댓글 삭제에 실패했습니다."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="text-sm">
      <h2 className="text-xs font-semibold text-neutral-700">
        댓글{comments ? ` ${comments.length}` : ""}
      </h2>

      {loadError && <p className="mt-2 text-xs text-red-600">{loadError}</p>}
      {!loadError && comments === null && (
        <p className="mt-2 text-xs text-neutral-400">불러오는 중…</p>
      )}
      {comments?.length === 0 && (
        <p className="mt-3 text-xs text-neutral-500">아직 댓글이 없습니다.</p>
      )}

      <ul className="mt-2 space-y-2">
        {(comments ?? []).map((comment) => {
          const isAuthor = viewer !== null && comment.authorId === viewer.id;
          const busy = busyId === comment.id;
          return (
            <li key={comment.id} className="rounded-lg border border-neutral-200 px-2.5 py-2">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-xs font-medium text-neutral-800">
                  {comment.authorName}
                </span>
                {comment.authorIsAdmin && <AdminCrown className="text-[11px]" />}
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {formatWhen(comment.createdAt)}
                  {comment.updatedAt !== comment.createdAt ? " · 수정됨" : ""}
                </span>
              </div>

              {editing?.id === comment.id ? (
                <div className="mt-1.5">
                  <textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ id: comment.id, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit();
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    rows={2}
                    maxLength={COMMENT_MAX_LENGTH}
                    autoFocus
                    className="w-full resize-none rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={busy}
                      className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* whitespace-pre-wrap keeps the author's line breaks while
                      the body stays a text node - never set as HTML. */}
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-neutral-700">
                    {comment.body}
                  </p>
                  {(isAuthor || viewer?.isAdmin) && (
                    <div className="mt-1 flex gap-2 text-[11px] text-neutral-400">
                      {isAuthor && (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: comment.id, body: comment.body })}
                          className="hover:text-neutral-700 hover:underline"
                        >
                          수정
                        </button>
                      )}
                      {/* Admins get delete but not edit: rewording someone's
                          comment would put words in their mouth. */}
                      <button
                        type="button"
                        onClick={() => remove(comment.id)}
                        disabled={busy}
                        className="hover:text-red-600 hover:underline disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter posts and Shift+Enter breaks the line - the habit everyone
            // brings from chat apps.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={COMMENT_MAX_LENGTH}
          disabled={submitting}
          placeholder="댓글 남기기 (Enter 등록, Shift+Enter 줄바꿈)"
          className="w-full resize-none rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          {formError ? (
            <p className="text-[11px] text-red-600">{formError}</p>
          ) : (
            <span className="text-[11px] text-neutral-400">
              {draft.length > 0 ? `${draft.length}/${COMMENT_MAX_LENGTH}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !draft.trim()}
            className="shrink-0 rounded bg-neutral-900 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
          >
            {submitting ? "등록 중…" : "등록"}
          </button>
        </div>
      </div>
    </section>
  );
}
