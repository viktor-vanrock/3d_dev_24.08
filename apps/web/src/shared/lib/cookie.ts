export function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (match === undefined) return null;
  return decodeURIComponent(match.slice(name.length + 1));
}
