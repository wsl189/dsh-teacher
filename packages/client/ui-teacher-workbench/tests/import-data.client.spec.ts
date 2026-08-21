import { describe, expect, it } from 'vitest'
import type { TeacherExam, TeacherStudent, TeacherStudentId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  parseScoreImport,
  parseStudentImport,
  summarizeExam,
} from '../src/client/import-data.ts'

const student = (id: string, name: string, studentNumber: string): TeacherStudent => ({
  id: id as TeacherStudentId,
  classId: 'class-a' as never,
  name,
  studentNumber,
  gender: '',
  guardian: '',
  relation: '',
  phone: '',
  address: '',
  extras: {},
})

describe('teacher-workbench document import', () => {
  it('normalizes spreadsheet headers and preserves unknown roster columns', () => {
    const result = parseStudentImport([
      '学生姓名\t学号\t性别\t家长姓名\t手机号\t特长',
      '张同学\t001\t女\t张女士\t13800000000\t绘画',
      '\t002\t男\t李先生\t\t足球',
    ].join('\n'))
    expect(result).toEqual({
      error: null,
      rows: [{
        name: '张同学', studentNumber: '001', gender: '女', guardian: '张女士',
        relation: '', phone: '13800000000', address: '', extras: { 特长: '绘画' },
      }],
    })
  })

  it('reports missing headers and empty input', () => {
    const empty = parseStudentImport('')
    expect(empty.rows).toEqual([])
    expect(typeof empty.error).toBe('string')
    expect(parseStudentImport('学号\t性别\n1\t男')).toMatchObject({ rows: [], error: '未找到姓名列' })
    expect(parseStudentImport('姓名\t学号\n\t1')).toMatchObject({ rows: [], error: '没有可导入的学生行' })
  })

  it('ignores blank or headerless extra roster cells', () => {
    expect(parseStudentImport('姓名\t\t备注\n张同学\t忽略\t\n李同学\t\t认真\t多余')).toMatchObject({
      rows: [
        { name: '张同学', extras: {} },
        { name: '李同学', extras: { '备注': '认真' } },
      ],
    })
  })

  it('treats omitted trailing roster cells as blank', () => {
    expect(parseStudentImport('姓名\t学号\n张同学')).toMatchObject({
      rows: [{ name: '张同学', studentNumber: '' }],
      error: null,
    })
  })

  it('parses quoted CSV and matches scores by number before unambiguous name', () => {
    const students = [student('s1', '张,同学', '001'), student('s2', '李同学', '002')]
    const result = parseScoreImport([
      '姓名,学号,语文,数学,排名',
      '"张,同学",001,88,91,1',
      '李同学,,77,not-a-number,2',
      '未知,,60,70,3',
    ].join('\n'), students)
    expect(result.subjects).toEqual(['语文', '数学'])
    expect(result.entries).toEqual([
      { studentId: 's1', scores: { 语文: 88, 数学: 91 } },
      { studentId: 's2', scores: { 语文: 77 } },
    ])
    expect(result.unmatched).toBe(1)
    expect(result.error).toBeNull()
  })

  it('parses MinerU Markdown and HTML tables with surrounding document text', () => {
    expect(parseStudentImport(`
# 高一（1）班学生名册

| 学生姓名 | 学号 | 性别 | 家长姓名 | 手机号 |
| --- | --- | --- | --- | --- |
| 张同学 | 001 | 女 | 张女士 | 13800000000 |
`)).toMatchObject({
      error: null,
      rows: [{ name: '张同学', studentNumber: '001', gender: '女', guardian: '张女士' }],
    })

    const students = [student('s1', '张同学', '001'), student('s2', '李同学', '002')]
    expect(parseScoreImport(`
<p>期中考试成绩</p>
<table>
  <tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr>
  <tr><td>张同学</td><td>001</td><td>88</td><td>91</td></tr>
</table>
<table>
  <tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr>
  <tr><td>李同学</td><td>002</td><td>79</td><td>84</td></tr>
</table>
`, students)).toMatchObject({
      subjects: ['语文', '数学'],
      entries: [
        { studentId: 's1', scores: { 语文: 88, 数学: 91 } },
        { studentId: 's2', scores: { 语文: 79, 数学: 84 } },
      ],
      unmatched: 0,
      error: null,
    })
  })

  it('coalesces repeated MinerU image fragments', () => {
    const rosterTable = '<table><tr><th>姓名</th><th>学号</th></tr><tr><td>张同学</td><td>001</td></tr></table>'
    expect(parseStudentImport(`${rosterTable}\n${rosterTable}`)).toMatchObject({
      rows: [{ name: '张同学', studentNumber: '001' }],
      error: null,
    })

    const students = [student('s1', '张同学', '001')]
    expect(parseScoreImport(`
<table><tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr><tr><td>张同学</td><td>001</td><td>88</td><td></td></tr></table>
<table><tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr><tr><td>张同学</td><td>001</td><td>87</td><td>91</td></tr></table>
<table><tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr><tr><td>未知</td><td>999</td><td>70</td><td>80</td></tr></table>
<table><tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr><tr><td>未知</td><td>999</td><td>70</td><td>80</td></tr></table>
`, students)).toMatchObject({
      subjects: ['语文', '数学'],
      entries: [{ studentId: 's1', scores: { 语文: 88, 数学: 91 } }],
      unmatched: 1,
      error: null,
    })
  })

  it('rejects score input without an identity column or matched numeric rows', () => {
    const students = [student('s1', '张同学', '001'), student('s2', '同名', ''), student('s3', '同名', '')]
    expect(parseScoreImport('', students).error).toContain('表头')
    expect(parseScoreImport('语文\t数学\n80\t90', students).error).toContain('姓名或学号')
    const ambiguous = parseScoreImport('姓名\t语文\n同名\t80', students)
    expect(ambiguous).toMatchObject({ entries: [], unmatched: 1, error: '没有可导入的成绩行' })
  })

  it('handles escaped quotes, blank scores, short rows, and full-width decimals', () => {
    const students = [student('s1', '张"同学', ''), student('s2', '李同学', '')]
    expect(parseScoreImport([
      '姓名,语文,数学',
      '"张""同学",88，5,',
      '李同学,77',
      '李同学,缺考',
    ].join('\n'), students)).toMatchObject({
      entries: [
        { studentId: 's1', scores: { '语文': 88.5 } },
        { studentId: 's2', scores: { '语文': 77 } },
      ],
    })
  })
})

describe('summarizeExam', () => {
  it('calculates subjects, totals, rank, and configured rates', () => {
    const exam: TeacherExam = {
      id: 'exam' as never,
      classId: 'class' as never,
      name: '期中',
      date: '',
      entries: [
        { studentId: 's1' as TeacherStudentId, scores: { 数学: 95, 语文: 85 } },
        { studentId: 's2' as TeacherStudentId, scores: { 数学: 60 } },
      ],
    }
    expect(summarizeExam(exam, 60, 85)).toEqual({
      count: 2,
      subjects: ['数学', '语文'],
      average: 120,
      highest: 180,
      lowest: 60,
      passRate: 50,
      excellentRate: 50,
      students: [
        { studentId: 's1', total: 180, rank: 1 },
        { studentId: 's2', total: 60, rank: 2 },
      ],
    })
  })

  it('returns stable zeros for an empty exam', () => {
    const summary = summarizeExam({ id: 'e' as never, classId: 'c' as never, name: '空', date: '', entries: [] }, 60, 85)
    expect(summary).toMatchObject({ count: 0, average: 0, highest: 0, lowest: 0, passRate: 0, excellentRate: 0, students: [] })
  })
})
