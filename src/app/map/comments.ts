// Plain module, not "use server": comment-actions.ts may only export async
// functions, so the shapes it hands back and the limits both sides enforce
// live here instead (same split as photo-storage.ts).

export const COMMENT_MAX_LENGTH = 1000;

// A comment always belongs to exactly one subject - see the
// comments_one_subject constraint in 20260911120000_comments.sql. `kind`
// picks which of the two nullable columns the id fills.
export interface CommentSubject {
  kind: "photo" | "hike";
  id: string;
}

export interface CommentView {
  id: string;
  body: string;
  // Null once the author's membership is removed; the comment itself stays.
  authorId: string | null;
  authorName: string;
  // Drives the crown beside the name, the same marker the roster uses.
  authorIsAdmin: boolean;
  createdAt: string;
  // Equal to createdAt until the author edits, which is how the UI decides
  // whether to show a "(수정됨)" marker.
  updatedAt: string;
}

export interface CommentThreadData {
  comments: CommentView[];
  // The viewer travels with the comments so the thread can gate its own
  // edit/delete buttons wherever it is mounted - the lightbox opens from
  // pages that never loaded the viewer's member row.
  viewerId: string;
  viewerIsAdmin: boolean;
}
