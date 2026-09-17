/** Only same-origin absolute paths may follow an authentication callback. */
export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/map";
  return value;
}
