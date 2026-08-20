import { describe, expect, it } from 'vitest'
import { isPlausibleClassName, parseTimetable } from '../src/client/timetable-import.ts'

describe('parseTimetable', () => {
  it('projects a weekday matrix into normalized shared entries', () => {
    const drafts = parseTimetable(`
| 节次 | 周一 | 周二 |
| --- | --- | --- |
| 第1节 08:00-08:45 | 数学<br>教师：张老师<br>高一（1）班<br>地点：101教室 | 语文 |
| 第2节 | 英语 | — |
`, { className: '高一（1）班', classNames: ['高一（1）班'], grade: '高一', kind: 'lesson', teacherName: '张老师' })

    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({
      className: '高一（1）班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '08:00', endTime: '08:45', subject: '数学', teacherName: '张老师', location: '101教室',
    })
    expect(drafts[1]).toMatchObject({ weekday: 2, period: 1, subject: '语文' })
    expect(drafts[2]).toMatchObject({ weekday: 1, period: 2, subject: '英语' })
  })

  it('recognizes row-oriented lesson and study tables', () => {
    const drafts = parseTimetable(`
| 星期 | 节次 | 班级 | 年级 | 课程 | 教师 | 地点 |
| --- | --- | --- | --- | --- | --- | --- |
| 周三 | 第3节 10:00-10:45 | 高二（3）班 | 高二 | 物理 | 李老师 | 实验室 |
| 周四 | 早自习 | 高二（3）班 | 高二 | 英语晨读 | 王老师 | 203教室 |
`, { className: '', classNames: [], grade: '', kind: 'lesson', teacherName: '' })

    expect(drafts).toEqual([
      expect.objectContaining({ weekday: 3, period: 3, kind: 'lesson', subject: '物理', className: '高二（3）班' }),
      expect.objectContaining({ weekday: 4, period: 1, kind: 'morningStudy', subject: '英语晨读', teacherName: '王老师' }),
    ])
  })

  it('expands HTML row spans and falls back to readable text lines', () => {
    const html = parseTimetable(`
<table>
  <tr><th>节次</th><th>周一</th><th>周二</th></tr>
  <tr><td rowspan="2">晚自习</td><td>数学答疑</td><td>语文阅读</td></tr>
  <tr><td>物理答疑</td><td>英语阅读</td></tr>
</table>
`, { className: '九年级2班', classNames: ['九年级2班'], grade: '九年级', kind: 'eveningStudy', teacherName: '陈老师' })
    expect(html.map(item => [item.weekday, item.period, item.subject])).toEqual([
      [1, 1, '数学答疑'], [2, 1, '语文阅读'], [1, 2, '物理答疑'], [2, 2, '英语阅读'],
    ])

    const text = parseTimetable(
      '周五 第4节 高一（2）班 化学 赵老师 地点：化学实验室',
      { className: '', classNames: [], grade: '', kind: 'lesson', teacherName: '' },
    )
    expect(text[0]).toMatchObject({ weekday: 5, period: 4, className: '高一（2）班', grade: '高一', subject: '化学' })
  })

  it('recognizes morning and afternoon rows from a class timetable', () => {
    const drafts = parseTimetable(`
高三（11）班 课程表 23-24上
<table>
  <tr><td rowspan="2" colspan="2">午别\\节目\\星期</td><td>一</td><td>二</td><td>三</td><td>四</td><td>五</td></tr>
  <tr><td colspan="5"></td></tr>
  <tr><td rowspan="4">上午</td><td>1</td><td>数学</td><td>语文</td><td>化学</td><td>英语</td><td>英语</td></tr>
  <tr><td>2</td><td>数学</td><td>英语</td><td>生物学</td><td>数学</td><td>英语</td></tr>
  <tr><td>3</td><td>语文</td><td>化学</td><td>物理</td><td>物理</td><td>语文</td></tr>
  <tr><td>4</td><td>体育与健康</td><td>生物学</td><td>音乐</td><td>物理</td><td>数学</td></tr>
  <tr><td colspan="7"></td></tr>
  <tr><td rowspan="4">下午</td><td>1</td><td>生物学</td><td>数学</td><td>语文</td><td>生物学</td><td>物理</td></tr>
  <tr><td>2</td><td>化学</td><td>物理</td><td>英语</td><td>化学</td><td>生物学</td></tr>
  <tr><td>3</td><td>英语</td><td>自习</td><td>数学</td><td>语文</td><td>化学</td></tr>
  <tr><td>4</td><td>英语</td><td>班会</td><td>数学</td><td>语文</td><td>自习</td></tr>
</table>
`, { className: '五班', classNames: ['五班'], grade: '高二', kind: 'lesson', teacherName: '当前教师' })

    expect(drafts).toHaveLength(40)
    expect(drafts[0]).toMatchObject({ className: '高三（11）班', grade: '高三', weekday: 1, period: 1, subject: '数学', teacherName: '' })
    expect(drafts).toContainEqual(expect.objectContaining({ weekday: 1, period: 5, subject: '生物学' }))
    expect(drafts).toContainEqual(expect.objectContaining({ weekday: 5, period: 8, subject: '自习' }))
  })

  it('maps multi-level grade tables across repeated weekday blocks', () => {
    const drafts = parseTimetable(`
<table>
  <tr><td rowspan="2">星期班级早读</td><td colspan="3">星期一</td><td colspan="3">星期二</td></tr>
  <tr><td>1</td><td>2</td><td>1</td><td>2</td><td>1</td><td></td></tr>
  <tr><td>第一节</td><td>数学张三</td><td>语文李四</td><td>1</td><td>英语王五</td><td>化学赵六</td><td>1</td></tr>
  <tr><td>第二节</td><td>英语王五</td><td>数学张三</td><td>2</td><td>语文李四</td><td>生物学钱七</td><td>2</td></tr>
  <tr><td colspan="7"></td></tr>
  <tr><td>第一节</td><td>历史孙八</td><td>地理周九</td><td>1</td><td>物理吴十</td><td>音乐郑一</td><td>1</td></tr>
  <tr><td>第二节</td><td>班会张三</td><td>自习自习</td><td>2</td><td>体育与健康赵六</td><td>美术钱七</td><td>2</td></tr>
  <tr><td rowspan="2">星期班级早读</td><td colspan="3">星期四</td><td colspan="3">星期五</td></tr>
  <tr><td>1</td><td>2</td><td>1</td><td>2</td><td>1</td><td></td></tr>
  <tr><td>第一节</td><td>化学赵六</td><td>英语王五</td><td>1</td><td>数学张三</td><td>语文李四</td><td>1</td></tr>
  <tr><td>第二节</td><td>生物学钱七</td><td>物理吴十</td><td>2</td><td>历史孙八</td><td>地理周九</td><td>2</td></tr>
  <tr><td colspan="7"></td></tr>
  <tr><td>第一节</td><td>音乐郑一</td><td>美术钱七</td><td>1</td><td>体育与健康赵六</td><td>班会张三</td><td>1</td></tr>
  <tr><td>第二节</td><td>自习自习</td><td>语文李四</td><td>2</td><td>英语王五</td><td>数学张三</td><td>2</td></tr>
</table>
`, { className: '', classNames: ['高三（1）班', '高三（2）班'], grade: '高三', kind: 'lesson', teacherName: '' })

    expect(drafts).toHaveLength(32)
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（1）班', weekday: 1, period: 1, subject: '数学', teacherName: '张三' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（1）班', weekday: 2, period: 1, subject: '英语', teacherName: '王五' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（1）班', weekday: 1, period: 3, subject: '历史', teacherName: '孙八' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（2）班', weekday: 5, period: 4, subject: '数学', teacherName: '张三' }))
  })

  it('uses a discarded grade title to name classes in a grade-wide matrix', () => {
    const drafts = parseTimetable(`
高三年

<table>
  <tr><td rowspan="2">星期班级早读</td><td colspan="3">星期一</td><td colspan="3">星期二</td></tr>
  <tr><td>1</td><td>2</td><td>1</td><td>2</td><td>1</td><td></td></tr>
  <tr><td>第一节</td><td>数学张三</td><td>语文李四</td><td>1</td><td>英语王五</td><td>物理赵六</td><td>1</td></tr>
  <tr><td>第二节</td><td>英语王五</td><td>数学张三</td><td>2</td><td>语文李四</td><td>生物钱七</td><td>2</td></tr>
</table>
`, { className: '', classNames: [], grade: '', kind: 'lesson', teacherName: '' })

    expect(drafts).toHaveLength(8)
    expect(drafts.every(item => item.selected)).toBe(true)
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（1）班', grade: '高三', weekday: 1, subject: '数学', teacherName: '张三' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高三（2）班', grade: '高三', weekday: 2, subject: '物理', teacherName: '赵六' }))
  })

  it('projects class-column morning and evening study tables', () => {
    const drafts = parseTimetable(`
25-26学年第一学期高二早读安排表

<table>
  <tr><td>班级</td><td>高二1班</td><td>高二2班</td></tr>
  <tr><td>星期一</td><td>王俊茹</td><td>蔡晓瑜</td></tr>
  <tr><td>星期二（英）</td><td>江海莲</td><td>王勇</td></tr>
</table>

25-26学年第一学期高二晚自习安排表（2025.8.31）

<table>
  <tr><td>班级</td><td>高二1班</td><td>高二2班</td></tr>
  <tr><td>星期一</td><td>江海莲</td><td>蔡晓瑜*</td></tr>
  <tr><td>星期二</td><td>王俊茹</td><td>王勇</td></tr>
</table>
`, { className: '', classNames: [], grade: '', kind: 'morningStudy', teacherName: '' })

    expect(drafts).toHaveLength(8)
    expect(drafts.every(item => item.selected)).toBe(true)
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高二1班', grade: '高二', kind: 'morningStudy', weekday: 1, subject: '早读', teacherName: '王俊茹' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高二2班', kind: 'morningStudy', weekday: 2, subject: '英语', teacherName: '王勇' }))
    expect(drafts).toContainEqual(expect.objectContaining({ className: '高二2班', kind: 'eveningStudy', weekday: 1, subject: '晚自习', teacherName: '蔡晓瑜' }))
  })

  it('leaves timetable headers and period labels unselected instead of treating them as classes', () => {
    const drafts = parseTimetable(`
| 星期 | 节次 | 班级 | 课程 |
| --- | --- | --- | --- |
| 周一 | 第一节 | 第一节 | 数学 |
| 周二 | 第二节 | 星期班级早读 | 语文 |
`, { className: '', classNames: [], grade: '高二', kind: 'lesson', teacherName: '' })

    expect(drafts).toHaveLength(2)
    expect(drafts.map(item => ({ className: item.className, selected: item.selected }))).toEqual([
      { className: '', selected: false },
      { className: '', selected: false },
    ])
    expect(isPlausibleClassName('高三（11）班')).toBe(true)
    expect(isPlausibleClassName('五班')).toBe(true)
    expect(isPlausibleClassName('第一节')).toBe(false)
    expect(isPlausibleClassName('星期班级早读')).toBe(false)
  })
})
