import { describe, expect, it } from 'vitest'
import { parseSchoolCalendar } from '../src/client/calendar-import.ts'

describe('school-calendar recognition projection', () => {
  it('uses table spans and ignores responsibility columns', () => {
    const markdown = `
      <h1>福州市马尾第一中学 2026年5月份工作安排</h1>
      <table>
        <tr><th colspan="3">周一</th><th colspan="3">周二</th><th colspan="3">周六、周日</th></tr>
        <tr><th>内容</th><th>负责人</th><th>部门</th><th>内容</th><th>负责人</th><th>部门</th><th>内容</th><th>负责人</th><th>部门</th></tr>
        <tr><td colspan="3">5月18日</td><td colspan="3">5月19日</td><td colspan="3">5月23、24日</td></tr>
        <tr>
          <td>1. 开旗仪式：“六一”儿童节<br/>2. 新教师考核周</td><td>郑、李</td><td>德</td>
          <td>1. 主题班会：争创佳绩<br/>2. 体育特长生特色班招考</td><td>郑、李</td><td>德</td>
          <td>体育艺术特长生特色班招生专业测试</td><td>杨</td><td>教</td>
        </tr>
      </table>
    `
    const items = parseSchoolCalendar(markdown, 2025)
    expect(items.map(item => [item.date, item.title])).toEqual([
      ['2026-05-18', '开旗仪式：“六一”儿童节'],
      ['2026-05-18', '新教师考核周'],
      ['2026-05-19', '主题班会：争创佳绩'],
      ['2026-05-19', '体育特长生特色班招考'],
      ['2026-05-23', '体育艺术特长生特色班招生专业测试'],
      ['2026-05-24', '体育艺术特长生特色班招生专业测试'],
    ])
    expect(items.some(item => item.title.includes('郑、李'))).toBe(false)
  })

  it('keeps content columns aligned beneath row-spanning week and note cells', () => {
    const items = parseSchoolCalendar(`
      <h1>2026年5月份工作安排</h1>
      <table>
        <tr><th></th><th colspan="3">周一</th><th colspan="3">周二</th><th>备注</th></tr>
        <tr><th></th><th>内容</th><th>负责人</th><th>部门</th><th>内容</th><th>负责人</th><th>部门</th><th></th></tr>
        <tr><td rowspan="2">第12周</td><td colspan="3">5月11日</td><td colspan="3">5月12日</td><td rowspan="2">全月说明</td></tr>
        <tr>
          <td>1. 市级教学开放周<br/>2. 信息技术水平考查（5.11-5.15）</td><td>郑、李</td><td>德</td>
          <td>1. 主题班会<br/>2. 教研组长会议<br/>3. 调休（上5月4日周一课表）</td><td>许、杨</td><td>研</td>
        </tr>
      </table>
    `, 2025)
    expect(items.map(item => [item.date, item.title])).toEqual([
      ['2026-05-11', '市级教学开放周'],
      ['2026-05-11', '信息技术水平考查（5.11-5.15）'],
      ['2026-05-12', '主题班会'],
      ['2026-05-12', '教研组长会议'],
      ['2026-05-12', '调休（上5月4日周一课表）'],
    ])
  })

  it('falls back to reading-order dated sections and rejects invalid dates', () => {
    const items = parseSchoolCalendar(`
      2027年春季校历
      2月28日
      1. 开学准备会
      2月30日
      不应导入
      3月1日
      正式开学
    `, 2026)
    expect(items.map(item => [item.date, item.title])).toEqual([
      ['2027-02-28', '开学准备会'],
      ['2027-03-01', '正式开学'],
    ])
  })
})
