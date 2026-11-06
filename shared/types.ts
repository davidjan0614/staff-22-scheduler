export type Shift='morning'|'afternoon';
export type AvailabilityStatus='available'|'unavailable'|'preferred';
export interface Employee {id:number;name:string;active:number;note:string;annualCount?:number}
export interface Availability {employee_id:number;work_date:string;status:AvailabilityStatus;preferred_shift:Shift|null;note:string}
export interface Assignment {id?:number;work_date:string;shift:Shift;employee_id:number|null;employee_name?:string|null;source:'auto'|'manual';warning?:string|null}
export interface MonthData {employees:Employee[];availability:Availability[];assignments:Assignment[];audit:{id:number;action:string;detail:string;created_at:string}[]}
