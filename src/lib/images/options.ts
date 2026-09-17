export function imageOptions(params: URLSearchParams): { width: number | undefined; quality: number } | null {
  const width = params.has("w") ? Number(params.get("w")) : undefined;
  const quality = params.has("q") ? Number(params.get("q")) : 80;
  if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 4096)) return null;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) return null;
  return { width, quality };
}
