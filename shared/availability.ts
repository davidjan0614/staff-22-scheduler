import type { Availability, RecurringCondition, Shift } from "./types";

export const validMonth = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
export function datesInMonth(month: string) {
  if (!validMonth(month)) throw new Error("月份格式錯誤");
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: last - 27 }, (_, i) => `${month}-${i + 28}`);
}
export function validWorkDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    validMonth(value.slice(0, 7)) &&
    datesInMonth(value.slice(0, 7)).includes(value)
  );
}
export function blockedShifts(a?: Availability): Shift[] {
  if (a?.status === "unavailable") return ["morning", "afternoon"];
  try {
    const values =
      typeof a?.blocked_shifts === "string"
        ? JSON.parse(a.blocked_shifts)
        : a?.blocked_shifts;
    return Array.isArray(values)
      ? values.filter(
          (s: unknown): s is Shift => s === "morning" || s === "afternoon",
        )
      : [];
  } catch {
    return [];
  }
}
export function isBlocked(
  employeeId: number,
  date: string,
  shift: Shift,
  availability: Availability[],
  recurring: RecurringCondition[] = [],
) {
  const a = availability.find(
    (x) => x.employee_id === employeeId && x.work_date === date,
  );
  // An explicitly confirmed date overrides the recurring defaults.
  if (a) return blockedShifts(a).includes(shift);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return recurring.some(
    (r) =>
      r.employee_id === employeeId &&
      r.weekday === weekday &&
      r.shift === shift,
  );
}
export function normalizePhone(value: string) {
  const phone = value.replace(/[\s-]/g, "");
  if (!phone) return "";
  if (/^09\d{8}$/.test(phone)) return `+886${phone.slice(1)}`;
  if (/^\+8869\d{8}$/.test(phone)) return phone;
  throw new Error("請輸入台灣手機號碼，例如 0912345678");
}
