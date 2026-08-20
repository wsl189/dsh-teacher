import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TeacherWeatherProvider,
  type TeacherWeatherProviderOptions,
} from '../src/weather.ts'

const geocoding = [{
  display_name: '浦东新区, 上海市, 上海市, 中国',
  lat: '31.2232671',
  lon: '121.5397849',
}]

const forecast = {
  timezone: 'Asia/Shanghai',
  current: {
    time: '2026-08-18T08:00',
    temperature_2m: 30.2,
    apparent_temperature: 34.1,
    relative_humidity_2m: 72,
    precipitation: 0.1,
    weather_code: 2,
    wind_speed_10m: 8.4,
  },
  hourly: {
    time: Array.from({ length: 13 }, (_, index) => `2026-08-18T${String(index + 8).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 13 }, (_, index) => 30 + index),
    precipitation_probability: Array.from({ length: 13 }, (_, index) => index),
    weather_code: Array.from({ length: 13 }, () => 2),
  },
  daily: {
    temperature_2m_max: [36],
    temperature_2m_min: [28],
    precipitation_probability_max: [45],
    sunrise: ['2026-08-18T05:20'],
    sunset: ['2026-08-18T18:31'],
  },
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function provider(
  fetchImpl: typeof fetch,
  overrides: Partial<TeacherWeatherProviderOptions> = {},
): TeacherWeatherProvider {
  return new TeacherWeatherProvider({
    geocodingEndpoint: 'https://nominatim.test/search',
    geocodingCacheEntries: 8,
    fetchImpl,
    now: () => 0,
    wait: async () => {},
    ...overrides,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TeacherWeatherProvider', () => {
  it('resolves a district and projects exactly twelve validated forecast hours', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
    const result = await provider(fetchImpl as typeof fetch).fetch(' 浦东新区, 上海市 ')

    expect(result).toMatchObject({
      ok: true,
      value: {
        location: '浦东新区 · 上海市 · 中国',
        timezone: 'Asia/Shanghai',
        temperature: 30.2,
        apparentTemperature: 34.1,
        humidity: 72,
        maximumTemperature: 36,
        minimumTemperature: 28,
        precipitationProbability: 45,
      },
    })
    if (!result.ok) throw new Error('valid weather was rejected')
    expect(result.value.hours).toHaveLength(12)
    expect(result.value.hours[0]).toEqual({
      time: '2026-08-18T08:00', temperature: 30, precipitationProbability: 0, weatherCode: 2,
    })
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.hours[0])).toBe(true)
    const geocodingUrl = new URL(String(fetchImpl.mock.calls[0]![0]))
    const forecastUrl = new URL(String(fetchImpl.mock.calls[1]![0]))
    expect(geocodingUrl.searchParams.get('q')).toBe('浦东新区, 上海市')
    expect(geocodingUrl.searchParams.get('layer')).toBe('address')
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      headers: { 'User-Agent': '@deepseek-ai/dsh-host-teacher-workbench/0.1' },
    })
    expect(forecastUrl.searchParams.get('latitude')).toBe('31.2232671')
    expect(forecastUrl.searchParams.get('longitude')).toBe('121.5397849')
    expect(forecastUrl.searchParams.get('forecast_hours')).toBe('12')
    expect(forecastUrl.searchParams.get('timezone')).toBe('auto')
  })

  it('caches location results, evicts least-recently-used entries, and rate-limits cache misses', async () => {
    const wait = vi.fn(async () => {})
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
      .mockResolvedValueOnce(response(forecast))
      .mockResolvedValueOnce(response([{ ...geocoding[0], display_name: '海淀区, 北京市, 中国' }]))
      .mockResolvedValueOnce(response(forecast))
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
    const weather = provider(fetchImpl as typeof fetch, { geocodingCacheEntries: 1, wait })

    await weather.fetch('浦东新区, 上海市')
    await weather.fetch('浦东新区, 上海市')
    await weather.fetch('海淀区, 北京市')
    await weather.fetch('浦东新区, 上海市')

    const queries = fetchImpl.mock.calls
      .map(call => new URL(String(call[0])))
      .filter(url => url.hostname === 'nominatim.test')
      .map(url => url.searchParams.get('q'))
    expect(queries).toEqual(['浦东新区, 上海市', '海淀区, 北京市', '浦东新区, 上海市'])
    expect(wait).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenNthCalledWith(1, 1_000)
  })

  it('uses the real timer delay when distinct geocoding requests arrive too quickly', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
    const weather = new TeacherWeatherProvider({
      geocodingEndpoint: 'https://nominatim.test/search',
      geocodingCacheEntries: 8,
      fetchImpl: fetchImpl as typeof fetch,
    })

    await weather.fetch('浦东新区, 上海市')
    const pending = weather.fetch('海淀区, 北京市')
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ ok: true })
  })

  it('does not retain failed geocoding requests', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
    const weather = provider(fetchImpl as typeof fetch)

    await expect(weather.fetch('浦东新区, 上海市')).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable', message: 'offline' },
    })
    await expect(weather.fetch('浦东新区, 上海市')).resolves.toMatchObject({ ok: true })
  })

  it('leaves the cache entry untouched when an evicted request fails', async () => {
    let rejectFirst!: (error: Error) => void
    const firstRequest = new Promise<Response>((_resolve, reject) => { rejectFirst = reject })
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response(forecast))
    const weather = provider(fetchImpl as typeof fetch, { geocodingCacheEntries: 1 })

    const first = weather.fetch('浦东新区, 上海市')
    const second = weather.fetch('海淀区, 北京市')
    rejectFirst(new Error('offline'))

    await expect(first).resolves.toMatchObject({ ok: false })
    await expect(second).resolves.toMatchObject({ ok: true })
  })

  it('rejects invalid or unknown locations with a stable code', async () => {
    await expect(provider(vi.fn() as typeof fetch).fetch(' ')).resolves.toMatchObject({
      ok: false,
      error: { code: 'location-not-found' },
    })
    const absent = vi.fn().mockResolvedValue(response([]))
    await expect(provider(absent as typeof fetch).fetch('不存在')).resolves.toMatchObject({
      ok: false,
      error: { code: 'location-not-found' },
    })
  })

  it('reports malformed geocoding payloads and empty location labels', async () => {
    for (const malformed of [
      [{ display_name: '上海市, 中国', lat: 'north', lon: '121' }],
      [{ display_name: '上海市, 中国', lat: '91', lon: '121' }],
      [{ display_name: '上海市, 中国', lat: '31', lon: '181' }],
      [{ display_name: ',', lat: '31', lon: '121' }],
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(response(malformed))
      await expect(provider(fetchImpl as typeof fetch).fetch('上海')).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-response' },
      })
    }
  })

  it('reports malformed forecasts and an empty hourly forecast', async () => {
    const noHours = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response({
        ...forecast,
        hourly: { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [] },
      }))
    await expect(provider(noHours as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-response' },
    })

    const invalidForecast = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(response({ ...forecast, current: null }))
    await expect(provider(invalidForecast as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-response' },
    })
  })

  it('distinguishes network, HTTP, and JSON failures', async () => {
    const nonErrorNetwork = vi.fn().mockRejectedValue('offline')
    await expect(provider(nonErrorNetwork as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable', message: 'weather provider request failed' },
    })

    const unavailable = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await expect(provider(unavailable as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })

    const invalidJson = vi.fn().mockResolvedValue(new Response('{'))
    await expect(provider(invalidJson as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-response' },
    })

    const invalidJsonResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue('not-json'),
    } as unknown as Response
    await expect(provider(
      vi.fn().mockResolvedValue(invalidJsonResponse) as typeof fetch,
    ).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-response', message: 'weather provider returned invalid JSON' },
    })

    const forecastUnavailable = vi.fn()
      .mockResolvedValueOnce(response(geocoding))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(provider(forecastUnavailable as typeof fetch).fetch('上海')).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
  })
})
