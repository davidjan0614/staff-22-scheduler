import type {Availability,Employee,Assignment,Shift} from '../shared/types';
import {SCHEDULING_RULES} from '../shared/rules';

export function monthDates(month:string){
  const [year,m]=month.split('-').map(Number); const last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return Array.from({length:last-SCHEDULING_RULES.startDay+1},(_,i)=>`${month}-${String(i+SCHEDULING_RULES.startDay).padStart(2,'0')}`);
}

export function generateSchedule(month:string,employees:Employee[],availability:Availability[],existing:Assignment[]=[]):Assignment[]{
  const dates=monthDates(month), shifts:Shift[]=SCHEDULING_RULES.shifts.map(s=>s.id);
  const fixed=new Map(existing.filter(x=>x.source==='manual').map(x=>[`${x.work_date}:${x.shift}`,x]));
  const used=new Set<number>(existing.filter(x=>x.source==='manual'&&x.employee_id).map(x=>x.employee_id!));
  const result:Assignment[]=[];
  const byEmployeeDate=new Map(availability.map(a=>[`${a.employee_id}:${a.work_date}`,a]));
  const slots=dates.flatMap(work_date=>shifts.map(shift=>({work_date,shift}))).sort((a,b)=>{
    const count=(slot:{work_date:string;shift:Shift})=>employees.filter(e=>eligible(e,slot.work_date,slot.shift,byEmployeeDate)).length;
    return count(a)-count(b);
  });
  for(const slot of slots){
    const key=`${slot.work_date}:${slot.shift}`; if(fixed.has(key)){result.push(fixed.get(key)!);continue;}
    const candidates=employees.filter(e=>!used.has(e.id)&&eligible(e,slot.work_date,slot.shift,byEmployeeDate)).sort((a,b)=>score(a,slot.work_date,slot.shift,byEmployeeDate)-score(b,slot.work_date,slot.shift,byEmployeeDate)||a.id-b.id);
    const selected=candidates[0];
    if(selected){used.add(selected.id);result.push({...slot,employee_id:selected.id,employee_name:selected.name,source:'auto'});}
    else result.push({...slot,employee_id:null,employee_name:null,source:'auto',warning:'目前條件下無可排人員'});
  }
  return result.sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.shift.localeCompare(b.shift));
}
function eligible(e:Employee,date:string,shift:Shift,map:Map<string,Availability>){const a=map.get(`${e.id}:${date}`);return !!e.active&&a?.status!=='unavailable'&&!(a?.status==='preferred'&&a.preferred_shift&&a.preferred_shift!==shift)}
function score(e:Employee,date:string,shift:Shift,map:Map<string,Availability>){const a=map.get(`${e.id}:${date}`);return (e.annualCount||0)*100+(a?.status==='preferred'&&a.preferred_shift===shift?-20:0)}
