// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeatherPanel } from '../src/client/WeatherPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { TeacherWeatherError, type TeacherWeatherForecast } from '../src/client/weather.ts'

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
})

const forecast: TeacherWeatherForecast = {
  location: '上海 · 中国',
  timezone: 'Asia/Shanghai',
  observedAt: '2026-08-18T08:00',
  temperature: 30.4,
  apparentTemperature: 34.2,
  humidity: 72,
  precipitation: 0.1,
  weatherCode: 0,
  windSpeed: 8.4,
  maximumTemperature: 36.2,
  minimumTemperature: 28.3,
  precipitationProbability: 45.2,
  sunrise: 'invalid',
  sunset: '2026-08-18T18:31',
  hours: Array.from({ length: 12 }, (_, index) => ({
    time: index === 0 ? 'invalid' : `2026-08-18T${String(index + 8).padStart(2, '0')}:00`,
    temperature: 30 + index / 10,
    precipitationProbability: index,
    weatherCode: [0, 1, 3, 45, 71, 95, 61, 2, 48, 86, 99, 80][index]!,
  })),
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WeatherPanel', () => {
  it('renders validated current details and twelve weather-code forecasts', async () => {
    const loadWeather = vi.fn()
      .mockResolvedValueOnce(forecast)
      .mockResolvedValueOnce(forecast)
      .mockResolvedValueOnce({ ...forecast, location: '北京 · 中国' })
    const saveLocation = vi.fn(async () => {})
    const collapse = vi.fn()
    render(
      <WeatherPanel
        expanded
        location="上海"
        onExpand={vi.fn()}
        onCollapse={collapse}
        onSaveLocation={saveLocation}
        loadWeather={loadWeather}
        t={t}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('正在获取天气')
    await screen.findByText('晴')
    expect(screen.getByText('34°')).toBeTruthy()
    expect(screen.getByText('72%')).toBeTruthy()
    expect(screen.getByText('最高 36° / 最低 28°')).toBeTruthy()
    expect(screen.getAllByText('invalid')).toHaveLength(2)
    expect(screen.getByText('天气数据由 Open-Meteo 提供')).toBeTruthy()
    expect(screen.getByText('位置数据 © OpenStreetMap contributors')).toBeTruthy()
    expect(document.querySelectorAll('[class*="hourlyForecast"] article')).toHaveLength(12)

    fireEvent.click(screen.getByRole('button', { name: '刷新天气' }))
    await waitFor(() => { expect(loadWeather).toHaveBeenCalledTimes(2) })
    const location = screen.getByLabelText('天气地点')
    fireEvent.change(location, { target: { value: ' 北京 ' } })
    fireEvent.submit(location.closest('form')!)
    await waitFor(() => {
      expect(saveLocation).toHaveBeenCalledWith('北京')
      expect(loadWeather).toHaveBeenCalledTimes(3)
    })
    fireEvent.click(screen.getByRole('button', { name: '恢复日常管理布局' }))
    expect(collapse).toHaveBeenCalledOnce()
  })

  it('maps location lookup, response, provider, and settings failures to visible states', async () => {
    const loadWeather = vi.fn(async (location: string) => {
      if (location === '不存在') throw new TeacherWeatherError('location-not-found', 'missing')
      if (location === '坏数据') throw new TeacherWeatherError('invalid-response', 'invalid')
      throw new Error('offline')
    })
    const props = {
      expanded: true,
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
      onSaveLocation: vi.fn(async () => {}),
      loadWeather,
      t,
    }
    const rendered = render(<WeatherPanel {...props} location="不存在" />)
    await screen.findByRole('alert')
    expect(screen.getByText('未找到这个地点')).toBeTruthy()

    rendered.rerender(<WeatherPanel {...props} location="坏数据" />)
    await screen.findByText('天气数据暂时无法识别')
    rendered.rerender(<WeatherPanel {...props} location="断网" />)
    await screen.findByText('天气服务暂时不可用')

    const rejecting = vi.fn(async () => { throw new Error('settings unavailable') })
    rendered.rerender(<WeatherPanel {...props} location="" onSaveLocation={rejecting} />)
    await screen.findByText('请在放大视图或设置中选择天气地点')
    const emptyLocation = screen.getByLabelText('天气地点')
    fireEvent.submit(emptyLocation.closest('form')!)
    expect(rejecting).not.toHaveBeenCalled()
    fireEvent.change(emptyLocation, { target: { value: '杭州' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    await screen.findByText('天气服务暂时不可用')
  })

  it('refreshes the same saved location and follows settings changes or an empty location', async () => {
    const loadWeather = vi.fn(async () => forecast)
    const saveLocation = vi.fn(async () => {})
    const props = {
      expanded: true,
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
      onSaveLocation: saveLocation,
      loadWeather,
      t,
    }
    const rendered = render(<WeatherPanel {...props} location="上海" />)
    await screen.findByText('晴')
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    await waitFor(() => { expect(loadWeather).toHaveBeenCalledTimes(2) })

    rendered.rerender(<WeatherPanel {...props} location="" />)
    await screen.findByText('未设置地点')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '刷新天气' }).disabled).toBe(true)
  })

  it('updates the compact clock and aborts its active weather request on unmount', () => {
    vi.useFakeTimers()
    const pending = new Promise<TeacherWeatherForecast>(() => {})
    const loadWeather = vi.fn(() => pending)
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    const rendered = render(
      <WeatherPanel
        expanded={false}
        location="上海"
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onSaveLocation={vi.fn(async () => {})}
        loadWeather={loadWeather}
        t={t}
      />,
    )
    act(() => { vi.advanceTimersByTime(1000) })
    rendered.unmount()
    expect(abort).toHaveBeenCalledOnce()
  })

  it('leaves a cancelled weather lookup without presenting an error', async () => {
    const loadWeather = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    render(
      <WeatherPanel
        expanded
        location="上海"
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onSaveLocation={vi.fn(async () => {})}
        loadWeather={loadWeather}
        t={t}
      />,
    )
    await waitFor(() => { expect(loadWeather).toHaveBeenCalledOnce() })
    expect(screen.getByRole('status').textContent).toContain('正在获取天气')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
