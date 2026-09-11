"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import {
  UNKNOWN_MEMBER_NAME,
  memberDirectory,
  type MemberSummary,
} from "@/lib/supabase/member-names";
import {
  COMMENT_MAX_LENGTH,
  type CommentSubject,
  type CommentThreadData,
  type CommentView,
} from "./comments";

const SELECT = "id, body, author_id, created_at, updated_at";

interface CommentRow {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

function toView(row: CommentRow, members: Map<string, MemberSummary>): CommentView {
  const author = row.author_id ? members.get(row.author_id) : null;
  return {
    id: row.id,
    body: row.body,
    authorId: row.author_id,
    authorName: author?.name ?? UNKNOWN_MEMBER_NAME,
    authorIsAdmin: author?.isAdmin ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Trimming here rather than trusting the client is the point: the browser can
// be bypassed, and the DB constraint would answer with a Postgres error rather
// than something a member can read.
function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("댓글을 입력해주세요.");
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    throw new Error(`댓글은 ${COMMENT_MAX_LENGTH}자까지 쓸 수 있습니다.`);
  }
  return trimmed;
}

/**
 * Fetched on open rather than preloaded with the map tree.
 *
 * An activity can hold a couple of hundred photos, so shipping every photo's
 * comments inside the /map payload would grow it by roughly the number of
 * photos even though a viewer opens one lightbox at a time. Activity comments
 * are few enough that preloading them would be fine, but routing both through
 * the same call keeps one code path and one RLS-checked query.
 */
export async function loadComments(subject: CommentSubject): Promise<CommentThreadData> {
  const { supabase, memberId, isAdmin } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("comments")
    .select(SELECT)
    .eq(subject.kind === "photo" ? "photo_id" : "hike_id", subject.id)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = data as unknown as CommentRow[];
  const names = await memberDirectory(supabase, rows.map((r) => r.author_id));

  return {
    comments: rows.map((row) => toView(row, names)),
    viewerId: memberId,
    viewerIsAdmin: isAdmin,
  };
}

export async function addComment(subject: CommentSubject, body: string): Promise<CommentView> {
  const { supabase, memberId } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("comments")
    .insert({
      author_id: memberId,
      photo_id: subject.kind === "photo" ? subject.id : null,
      hike_id: subject.kind === "hike" ? subject.id : null,
      body: cleanBody(body),
    })
    .select(SELECT)
    .single();
  if (error) throw error;

  // No revalidatePath: comments never enter the server-rendered /map payload
  // (see loadComments), so the thread's own state is the only thing to update
  // and invalidating the whole map tree would re-fetch every location for
  // nothing.
  const row = data as unknown as CommentRow;
  return toView(row, await memberDirectory(supabase, [row.author_id]));
}

// comments_update RLS restricts this to the author - an admin may delete a
// comment but never reword one.
export async function editComment(commentId: string, body: string): Promise<CommentView> {
  const { supabase } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("comments")
    .update({ body: cleanBody(body) })
    .eq("id", commentId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("댓글을 수정할 권한이 없습니다.");

  const row = data as unknown as CommentRow;
  return toView(row, await memberDirectory(supabase, [row.author_id]));
}

// comments_delete RLS allows the author or an admin; a row that matches
// neither simply deletes nothing, which is what the empty result means here.
export async function deleteComment(commentId: string): Promise<void> {
  const { supabase } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("댓글을 삭제할 권한이 없습니다.");
}
