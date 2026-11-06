import type {Shift} from './types';

export const SCHEDULING_RULES = {
  version: '1.0',
  effectiveDate: '2026-11-06',
  startDay: 28,
  shifts: [
    {id:'morning' as Shift,label:'早班',time:'08:00–12:30'},
    {id:'afternoon' as Shift,label:'下午班',time:'12:30–17:00'},
  ],
  maxAutoAssignmentsPerMonth: 1,
  principles: [
    {title:'先遵守不可排條件',text:'員工設定為「不可排」的日期，系統不會自動安排。'},
    {title:'每月自動排班不重複',text:'自動排班時，每人每月原則最多安排 1 班。'},
    {title:'年度次數少者優先',text:'符合資格的人員中，年度值班次數較少者優先，以維持長期公平。'},
    {title:'優先時段加權',text:'員工設定的早班或下午班優先時段，會提高該時段的排序。'},
    {title:'條件不足就保留缺額',text:'沒有符合條件的人員時，系統顯示缺額，不會違反不可排條件強行安排。'},
    {title:'Admin 可做特殊調整',text:'Admin 可以手動換人或安排同月第 2 班；系統會提示並保留調整紀錄。'},
    {title:'手動班次不被覆蓋',text:'再次執行自動公平排班時，Admin 已手動安排的班次會保留。'},
  ],
} as const;
