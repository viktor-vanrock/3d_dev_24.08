export function projectSummary(description: string | null): string {
  if (!description?.trim()) return "Автор пока не добавил описание и последовательность сборки.";
  return description
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}
