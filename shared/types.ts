export type Shift = "morning" | "afternoon";
export type AvailabilityStatus = "available" | "unavailable" | "preferred";
export interface Employee {
  id: number;
  name: string;
  active: number;
  note: string;
  annualCount?: number;
  phone?: string;
  sms_enabled?: number;
}
export interface Availability {
  employee_id: number;
  work_date: string;
  status: AvailabilityStatus;
  preferred_shift: Shift | null;
  note: string;
  blocked_shifts?: string | Shift[];
}
export interface RecurringCondition {
  employee_id: number;
  weekday: number;
  shift: Shift;
}
export interface Assignment {
  id?: number;
  work_date: string;
  shift: Shift;
  employee_id: number | null;
  employee_name?: string | null;
  source: "auto" | "manual";
  warning?: string | null;
}
export interface MonthData {
  employees: Employee[];
  availability: Availability[];
  assignments: Assignment[];
  recurring: RecurringCondition[];
  audit: { id: number; action: string; detail: string; created_at: string }[];
}
export interface SmsPreview {
  ready: boolean;
  reason: string;
  revision: string;
  items: {
    assignment_id: number;
    assignment_version: number;
    employee_id: number;
    name: string;
    phone: string;
    work_date: string;
    shift: Shift;
    body: string;
    state: string;
    fingerprint: string;
  }[];
  history: {
    id: number;
    employee_id: number;
    work_date: string;
    shift: Shift;
    status: string;
    confirmed_at: string | null;
    created_at: string;
    error: string | null;
  }[];
}
