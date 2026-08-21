/** Drag-and-drop class seating plan with roster import and image export. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileUp, GripVertical, Plus, RotateCcw, Search, Shuffle } from 'lucide-react'
import type { TeacherClassId, TeacherStudent, TeacherStudentId, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { DOCUMENT_IMPORT_ACCEPT, shouldEnhanceDocumentImage } from './document-import.ts'
import { parseStudentImport } from './import-data.ts'
import css from './TeacherWorkbench.module.css'

/** Seating-plan module props. */
export interface SeatingPlanProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation and document-extraction commands. */
  commands: TeacherWorkbenchCommands
}

type DraggedStudent = { kind: 'pool'; studentId: TeacherStudentId } | { kind: 'seat'; index: number }

const DEFAULT_ROWS = 5

/**
 * Render class selection, roster import, free placement, randomization, and image export.
 * @param props - durable workbench state and commands.
 * @returns the class seating workspace.
 */
export function SeatingPlan({ state, commands }: SeatingPlanProps) {
  const classes = useMemo(() => state.classes.filter(item => item.usage === 'roster'), [state.classes])
  const [classId, setClassId] = useState<TeacherClassId | ''>(() => classes[0]?.id ?? '')
  const selectedClass = classes.find(item => item.id === classId)
  const students = useMemo(() => state.students.filter(student => student.classId === classId), [classId, state.students])
  const persisted = state.seatingLayouts.find(item => item.classId === classId)
  const initialRows = persisted?.rows ?? DEFAULT_ROWS
  const initialColumns = persisted?.columns ?? columnsFor(students.length, initialRows)
  const [rows, setRows] = useState(initialRows)
  const [columns, setColumns] = useState(initialColumns)
  const [slots, setSlots] = useState<(TeacherStudentId | null)[]>(() => (
    persisted?.slots.slice() ?? fillSeats(students, initialRows, initialColumns)
  ))
  const [layoutClassId, setLayoutClassId] = useState<TeacherClassId | ''>(classId)
  const [search, setSearch] = useState('')
  const [dragged, setDragged] = useState<DraggedStudent | null>(null)
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (classId !== '' && classes.some(item => item.id === classId)) return
    setClassId(classes[0]?.id ?? '')
  }, [classId, classes])
  useEffect(() => {
    const next = state.seatingLayouts.find(item => item.classId === classId)
    const nextRows = next?.rows ?? DEFAULT_ROWS
    const nextColumns = next?.columns ?? columnsFor(state.students.filter(item => item.classId === classId).length, nextRows)
    setRows(nextRows)
    setColumns(nextColumns)
    setSlots(next?.slots.slice() ?? fillSeats(state.students.filter(item => item.classId === classId), nextRows, nextColumns))
    setLayoutClassId(classId)
  }, [classId])
  useEffect(() => {
    if (classId === '' || layoutClassId !== classId) return
    void commands.saveSeatingLayout({ classId, rows, columns, slots })
  }, [classId, layoutClassId, rows, columns, slots])
  useEffect(() => {
    const known = new Set(slots.filter((value): value is TeacherStudentId => value !== null))
    const missing = students.filter(student => !known.has(student.id))
    if (missing.length === 0) return
    let nextColumns = columns
    while (rows * nextColumns < students.length && nextColumns < 10) nextColumns += 1
    const next = resizeSlots(slots, rows, nextColumns)
    for (const student of missing) {
      const empty = next.indexOf(null)
      if (empty < 0) break
      next[empty] = student.id
    }
    if (nextColumns !== columns) setColumns(nextColumns)
    setSlots(next)
  }, [students])

  if (selectedClass === undefined) {
    return <div className={css.workspaceEmpty}><h3>请先在“学生名册”中新建班级</h3><p>排座位使用同一份班级名册，不需要重复维护学生信息。</p></div>
  }

  const studentById = new Map(students.map(student => [student.id, student]))
  const seated = new Set(slots.filter((value): value is TeacherStudentId => value !== null))
  const pool = students.filter(student => !seated.has(student.id) && student.name.includes(search))
  const resize = (nextRows: number, nextColumns: number): void => {
    setRows(nextRows)
    setColumns(nextColumns)
    setSlots(resizeSlots(slots, nextRows, nextColumns))
  }
  const reset = (): void => {
    const nextColumns = columnsFor(students.length, DEFAULT_ROWS)
    setRows(DEFAULT_ROWS)
    setColumns(nextColumns)
    setSlots(fillSeats(students, DEFAULT_ROWS, nextColumns))
    setNotice(`已恢复适合当前班级人数的 ${DEFAULT_ROWS} 排 × ${nextColumns} 列布局`)
  }
  const randomize = (): void => {
    const shuffled = shuffle(students)
    const indexes = shuffle([...Array(rows * columns).keys()])
    const next = Array<TeacherStudentId | null>(rows * columns).fill(null)
    shuffled.slice(0, next.length).forEach((student, index) => { next[indexes[index] as number] = student.id })
    setSlots(next)
    setNotice('已随机分配；空位保留，可继续任意拖拽调整')
  }
  const dropAt = (index: number): void => {
    if (dragged === null) return
    setSlots((current) => {
      const next = [...current]
      if (dragged.kind === 'pool') {
        if (next[index] !== null) return current
        const previous = next.indexOf(dragged.studentId)
        if (previous >= 0) next[previous] = null
        next[index] = dragged.studentId
      } else {
        const value = next[dragged.index]
        next[dragged.index] = next[index] ?? null
        next[index] = value ?? null
      }
      return next
    })
    setDragged(null)
  }
  const importRoster = async (file: File): Promise<void> => {
    setNotice('正在识别名单…')
    const result = await commands.extractDocument(file, { enhanceImageDetail: shouldEnhanceDocumentImage(file) })
    if (!result.ok) {
      setNotice(`名单识别失败：${result.error.message}`)
      return
    }
    const parsed = parseStudentImport(result.value.markdown)
    if (parsed.error !== null) {
      setNotice(parsed.error)
      return
    }
    const saved = await commands.importStudents(selectedClass.id, parsed.rows)
    setNotice(saved.ok ? `已导入 ${parsed.rows.length} 名学生，可继续拖拽调整` : `名单保存失败：${saved.error.message}`)
  }

  return (
    <div className={css.seatingView}>
      <header className={css.seatingToolbar}>
        <div><h2>可视化排座位</h2></div>
        <select aria-label="选择班级" value={classId} onChange={(event) => { setClassId(event.target.value as TeacherClassId) }}>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <div>
          <input ref={inputRef} className={css.calendarImportInput} type="file" accept={DOCUMENT_IMPORT_ACCEPT} onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) void importRoster(file)
          }} />
          <button type="button" className={css.buttonSecondary} onClick={() => { inputRef.current?.click() }}><FileUp size={16} />导入名单</button>
          <button type="button" className={css.buttonSecondary} onClick={randomize}><Shuffle size={16} />随机分配</button>
          <button type="button" className={css.buttonPrimary} onClick={() => { exportSeatingImage(selectedClass.name, rows, columns, slots, studentById) }}><Download size={16} />导出图片</button>
        </div>
      </header>
      {notice !== '' && <div className={css.seatNotice}>{notice}</div>}

      <div className={css.seatingLayout}>
        <aside className={css.studentPool}>
          <h3>待安排 <span>{students.length - seated.size}人</span></h3>
          <label><Search size={15} /><input value={search} placeholder="搜索学生" onChange={(event) => { setSearch(event.target.value) }} /></label>
          <div>{pool.length === 0 ? <p>全部学生已安排</p> : pool.map(student => <div key={student.id} draggable onDragStart={() => { setDragged({ kind: 'pool', studentId: student.id }) }}><GripVertical size={14} />{student.name}</div>)}</div>
        </aside>

        <section className={css.seatCanvas}>
          <div className={css.seatCanvasHead}><span>教室后方</span><strong>{rows} 排 × {columns} 列 · {rows * columns} 个座位</strong></div>
          <div className={css.seatCanvasScroll}>
            <div className={css.seatRoom} style={{ minWidth: Math.max(500, columns * 82) }}>
              <div className={css.seatGrid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                {Array.from({ length: rows }, (_, displayRow) => {
                  const row = rows - 1 - displayRow
                  return Array.from({ length: columns }, (_, column) => {
                    const index = row * columns + column
                    const student = slots[index] === null ? undefined : studentById.get(slots[index] as TeacherStudentId)
                    return <button key={index} type="button" className={student === undefined ? css.emptySeat : undefined} draggable={student !== undefined} onDragStart={() => { if (student !== undefined) setDragged({ kind: 'seat', index }) }} onDragOver={(event) => { event.preventDefault() }} onDrop={() => { dropAt(index) }} onClick={() => {
                      if (student === undefined) return
                      setSlots(current => current.map((value, currentIndex) => currentIndex === index ? null : value))
                    }}><span>{row + 1}排 · {column + 1}列</span><strong>{student?.name ?? '空位'}</strong>{student === undefined ? <Plus size={13} /> : <GripVertical size={13} />}</button>
                  })
                })}
              </div>
              <div className={css.teacherDesk}>讲台 · 教师视角</div>
              <div className={css.blackboard}>黑 板 <small>在教师身后</small></div>
            </div>
          </div>
        </section>

        <aside className={css.seatRules}>
          <div><h3>排座规则</h3><button type="button" onClick={reset}><RotateCcw size={15} />重置</button></div>
          <div className={css.seatSizeFields}>
            <label><span>排数</span><select value={rows} onChange={(event) => {
              resize(Number(event.target.value), columns)
            }}>{[3, 4, 5, 6, 7, 8].map(value => (
                <option key={value} value={value}>{value} 排</option>
              ))}</select></label>
            <label><span>列数</span><select value={columns} onChange={(event) => {
              resize(rows, Number(event.target.value))
            }}>{[4, 5, 6, 7, 8, 9, 10].map(value => (
                <option key={value} value={value}>{value} 列</option>
              ))}</select></label>
          </div>
          <div className={css.seatRuleNote}><strong>50人班级可完整呈现</strong><p>默认会根据人数扩展到最多 10 列。先随机分配，再把任意学生拖到空位或座位；第 1 排离讲台最近。</p></div>
          <button type="button" className={css.buttonPrimary} onClick={randomize}><Shuffle size={17} />随机分配后手动调整</button>
          <p>不根据成绩、性格等信息自动评价学生，最终选择权留给老师。</p>
        </aside>
      </div>
    </div>
  )
}

function columnsFor(studentCount: number, rows = DEFAULT_ROWS): number {
  return Math.min(10, Math.max(6, Math.ceil(studentCount / rows)))
}

function fillSeats(students: readonly TeacherStudent[], rows: number, columns: number): (TeacherStudentId | null)[] {
  const slots = Array<TeacherStudentId | null>(rows * columns).fill(null)
  students.slice(0, slots.length).forEach((student, index) => { slots[index] = student.id })
  return slots
}

function resizeSlots(
  slots: readonly (TeacherStudentId | null)[],
  rows: number,
  columns: number,
): (TeacherStudentId | null)[] {
  const next = Array<TeacherStudentId | null>(rows * columns).fill(null)
  slots.filter((value): value is TeacherStudentId => value !== null)
    .slice(0, next.length)
    .forEach((value, index) => { next[index] = value })
  return next
}

function shuffle<T>(values: readonly T[]): T[] {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const value = next[index] as T
    next[index] = next[target] as T
    next[target] = value
  }
  return next
}

function exportSeatingImage(
  className: string,
  rows: number,
  columns: number,
  slots: readonly (TeacherStudentId | null)[],
  students: ReadonlyMap<TeacherStudentId, TeacherStudent>,
): void {
  const canvas = document.createElement('canvas')
  canvas.width = 1_600
  canvas.height = 400 + rows * 132
  const context = canvas.getContext('2d')
  if (context === null) return
  context.fillStyle = '#f7f5ef'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#17211d'
  context.font = 'bold 42px sans-serif'
  context.textAlign = 'center'
  context.fillText(`${className} 座次表`, 800, 64)
  const width = (1_320 - 22 * (columns - 1)) / columns
  for (let displayRow = 0; displayRow < rows; displayRow += 1) {
    const row = rows - 1 - displayRow
    for (let column = 0; column < columns; column += 1) {
      const studentId = slots[row * columns + column]
      const student = studentId === null ? undefined : students.get(studentId as TeacherStudentId)
      const x = 140 + column * (width + 22)
      const y = 110 + displayRow * 132
      context.fillStyle = student === undefined ? '#ecebe6' : '#ffffff'
      context.strokeStyle = '#cbd3cd'
      context.beginPath()
      context.roundRect(x, y, width, 78, 12)
      context.fill()
      context.stroke()
      context.fillStyle = '#25342d'
      context.font = '24px sans-serif'
      context.fillText(student?.name ?? '空位', x + width / 2, y + 48)
    }
  }
  const deskY = 130 + rows * 132
  context.fillStyle = '#dce7df'
  context.fillRect(560, deskY, 480, 58)
  context.fillStyle = '#315d49'
  context.font = '22px sans-serif'
  context.fillText('讲台 · 教师视角', 800, deskY + 37)
  context.fillStyle = '#26332d'
  context.fillRect(240, deskY + 82, 1_120, 70)
  context.fillStyle = '#ffffff'
  context.font = '27px sans-serif'
  context.fillText('黑  板（在教师身后）', 800, deskY + 126)
  const link = document.createElement('a')
  link.download = `${className}-座次表.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}
