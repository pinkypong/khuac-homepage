// Plain module: a "use server" file may only export async functions, so the
// shared constant cannot live in actions.ts beside the action that uses it.
export const MAX_NAME_LENGTH = 20;
