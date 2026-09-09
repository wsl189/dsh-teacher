/** Dense grade timetable with separate teacher rows and merged weekday cells. */

const subjects = ['语文', '数学', '英语', '体育与健康', '综合实践活动', '劳动', '班会', '信息技术']
const teachers = ['陈静', '张建国', '杨欣怡', '贺俊', '王文博', '李慧敏', '朱雅雯', '邵明']
const times = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['10:05', '10:50'], ['11:00', '11:45'],
  ['14:00', '14:45'], ['14:55', '15:40'], ['15:55', '16:40'], ['16:50', '17:35'],
]

export const gradeTimetableEntries = Array.from({ length: 5 }, (_, day) => (
  Array.from({ length: 8 }, (_, slot) => Array.from({ length: 15 }, (_, column) => ({
    className: `高一${String(column + 1)}班`, grade: '高一', kind: 'lesson',
    weekday: day + 1, period: slot + 1, subject: subjects[(day + slot + column) % subjects.length]!,
    teacherName: teachers[column % teachers.length]!, startTime: times[slot]![0]!, endTime: times[slot]![1]!, location: '',
  }))).flat()
)).flat()

export const gradeTimetableMarkdown = `<table>
<tr><th colspan="19">高一年级总课表</th></tr>
<tr><td colspan="19">高一 1—15 班 周一至周五 每天 8 节</td></tr>
<tr><td colspan="4">时间／班级</td>${Array.from({ length: 15 }, (_, index) => `<td>高一${String(index + 1)}班</td>`).join('')}</tr>
${Array.from({ length: 40 }, (_, index) => {
  const day = Math.floor(index / 8)
  const period = index % 8 + 1
  const entries = gradeTimetableEntries.filter(entry => entry.weekday === day + 1 && entry.period === period)
  return `<tr>${period === 1 ? `<td rowspan="16">星<br>期<br>${'一二三四五'[day]}</td>` : ''}
${period === 1 || period === 5 ? `<td rowspan="8">${period === 1 ? '上' : '下'}<br>午</td>` : ''}
<td rowspan="2">${String(period)}</td><td rowspan="2">${times[period - 1]!.join('—')}</td>
${entries.map(entry => `<td>${entry.subject}</td>`).join('')}</tr>
<tr>${entries.map(entry => `<td>${entry.teacherName}</td>`).join('')}</tr>`
}).join('\n')}
<tr><td colspan="19">大课间 09:40—10:05；午间休息 11:45—14:00。共 600 节。</td></tr>
</table>`
