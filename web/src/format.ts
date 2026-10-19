export { formatPrice } from "@freepl/contract";

const isNum = (v: number | null | undefined): v is number => typeof v === "number";

export const f1 = (v: number | null | undefined) => (isNum(v) ? v.toFixed(1) : "—");
export const f2 = (v: number | null | undefined) => (isNum(v) ? v.toFixed(2) : "—");
export const int = (v: number | null | undefined) => (isNum(v) ? String(v) : "—");
export const kfmt = (v: number | null | undefined) =>
  !isNum(v) ? "—" : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

/** "3h ago", "2d ago" from an hour count. */
export function ago(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Local time, e.g. "Sat 18 Oct, 10:00". The instant comes from the API, never hardcoded. */
export function localDateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}, ${time}`;
}
