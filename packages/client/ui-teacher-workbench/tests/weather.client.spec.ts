import { describe, expect, it, vi } from 'vitest'
import type { TeacherWeatherForecast, TeacherWeatherRemote } from '../src/client/weather.ts'
import {
  fetchTeacherWeather,
  TeacherWeatherError,
  weatherCondition,
} from '../src/client/weather.ts'

const forecast: TeacherWeatherForecast = {
  location: '上海 · 中国',
  timezone: 'Asia/Shanghai',
  observedAt: '2026-08-18T08:00',
  temperature: 30.2,
  apparentTemperature: 34.1,
  humidity: 72,
  precipitation: 0.1,
  weatherCode: 2,
  windSpeed: 8.4,
  maximumTemperature: 36,
  minimumTemperature: 28,
  precipitationProbability: 45,
  sunrise: '2026-08-18T05:20',
  sunset: '2026-08-18T18:31',
  hours: [],
}

function remote(weather: TeacherWeatherRemote['weather']): TeacherWeatherRemote {
  return { weather }
}

describe('fetchTeacherWeather', () => {
  it('unwraps validated weather from the Host Remote', async () => {
    const weather = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: forecast } })
    await expect(fetchTeacherWeather('上海', remote(weather))).resolves.toBe(forecast)
    expect(weather).toHaveBeenCalledWith({ location: '上海' })
  })

  it('preserves provider failures and maps carrier failures', async () => {
    const rejected = remote(vi.fn().mockResolvedValue({
      ok: true,
      value: { ok: false, error: { code: 'location-not-found', message: 'missing' } },
    }))
    await expect(fetchTeacherWeather('不存在', rejected)).rejects.toEqual(
      expect.objectContaining({ code: 'location-not-found', message: 'missing' }),
    )

    const carrierFailure = remote(vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'transport', message: 'disconnected' },
    }))
    await expect(fetchTeacherWeather('上海', carrierFailure)).rejects.toEqual(
      expect.objectContaining({ code: 'provider-unavailable', message: 'disconnected' }),
    )
  })

  it('normalizes thrown Remote failures', async () => {
    await expect(fetchTeacherWeather(
      '上海',
      remote(vi.fn().mockRejectedValue(new Error('socket closed'))),
    )).rejects.toEqual(expect.objectContaining({ code: 'provider-unavailable', message: 'socket closed' }))
    await expect(fetchTeacherWeather(
      '上海',
      remote(vi.fn().mockRejectedValue('offline')),
    )).rejects.toEqual(expect.objectContaining({ code: 'provider-unavailable', message: 'teacher weather Remote failed' }))
  })

  it('supports cancellation before and during a Remote lookup', async () => {
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    const weather = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: forecast } })
    await expect(fetchTeacherWeather('上海', remote(weather), alreadyAborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })

    let settle: ((value: unknown) => void) | undefined
    const pending = new Promise((resolve) => { settle = resolve })
    const controller = new AbortController()
    const result = fetchTeacherWeather('上海', remote(vi.fn(() => pending) as TeacherWeatherRemote['weather']), controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    settle?.({ ok: true, value: { ok: true, value: forecast } })
    await Promise.resolve()
  })

  it('settles normally while an active cancellation signal remains idle', async () => {
    const controller = new AbortController()
    const weather = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: forecast } })
    await expect(fetchTeacherWeather('上海', remote(weather), controller.signal)).resolves.toBe(forecast)
  })
})

describe('weatherCondition', () => {
  it.each([
    [0, '晴'], [1, '少云'], [2, '少云'], [3, '阴'], [45, '有雾'], [48, '有雾'],
    [51, '毛毛雨'], [61, '有雨'], [71, '有雪'], [95, '雷雨'], [100, '天气变化'],
  ])('maps WMO code %i to %s', (code, expected) => {
    expect(weatherCondition(code)).toBe(expected)
  })

  it('exposes a named error for UI narrowing', () => {
    expect(new TeacherWeatherError('location-not-found', 'missing')).toMatchObject({
      name: 'TeacherWeatherError', code: 'location-not-found', message: 'missing',
    })
  })
})
