/** Host-side geocoding and Open-Meteo adapter for the teacher workbench. */

import { z } from 'zod'
import type {
  TeacherWeatherErrorCode,
  TeacherWeatherForecast,
  TeacherWeatherResult,
} from './types.ts'

/** Public Nominatim search endpoint used by the shipped Web composition. */
export const DEFAULT_WEATHER_GEOCODING_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
/** Maximum resolved locations retained by the shipped Web composition. */
export const DEFAULT_WEATHER_GEOCODING_CACHE_ENTRIES = 256

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_REQUEST_INTERVAL_MS = 1_000
const GEOCODING_USER_AGENT = '@deepseek-ai/dsh-host-teacher-workbench/0.1'

const locationQuerySchema = z.string().trim().min(1).max(80)
const coordinateSchema = z.string().transform(Number).pipe(z.number())
const geocodingSchema = z.array(z.object({
  display_name: z.string().trim().min(1),
  lat: coordinateSchema.pipe(z.number().min(-90).max(90)),
  lon: coordinateSchema.pipe(z.number().min(-180).max(180)),
}))
const forecastSchema = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    relative_humidity_2m: z.number(),
    precipitation: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    precipitation_probability: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
  daily: z.object({
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number()).min(1),
    sunrise: z.array(z.string()).min(1),
    sunset: z.array(z.string()).min(1),
  }),
})

interface ResolvedWeatherLocation {
  readonly label: string
  readonly latitude: number
  readonly longitude: number
}

/** Construction options for one cached, rate-limited weather provider. */
export interface TeacherWeatherProviderOptions {
  /** Nominatim-compatible search endpoint. */
  readonly geocodingEndpoint: string
  /** Maximum distinct resolved-location queries retained in memory. */
  readonly geocodingCacheEntries: number
  /** Fetch implementation used for geocoding and forecasts. */
  readonly fetchImpl?: typeof fetch
  /** Clock used to enforce the public geocoder request interval. */
  readonly now?: () => number
  /** Delay implementation used to serialize public geocoder requests. */
  readonly wait?: (durationMs: number) => Promise<void>
}

class WeatherProviderError extends Error {
  constructor(readonly code: TeacherWeatherErrorCode, message: string) {
    super(message)
  }
}

/** Cached Host weather provider supporting district, county, and city queries. */
export class TeacherWeatherProvider {
  private readonly geocodingEndpoint: string
  private readonly geocodingCacheEntries: number
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly wait: (durationMs: number) => Promise<void>
  private readonly locationCache = new Map<string, Promise<ResolvedWeatherLocation | undefined>>()
  private geocodingTail: Promise<void> = Promise.resolve()
  private lastGeocodingRequestAt = Number.NEGATIVE_INFINITY

  /**
   * @param options - provider endpoint, cache limit, and optional test dependencies.
   */
  constructor(options: TeacherWeatherProviderOptions) {
    this.geocodingEndpoint = options.geocodingEndpoint
    this.geocodingCacheEntries = options.geocodingCacheEntries
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.now = options.now ?? Date.now
    this.wait = options.wait ?? (durationMs => new Promise(resolve => setTimeout(resolve, durationMs)))
  }

  /**
   * Resolve a location and return validated current conditions and twelve forecast hours.
   * @param query - untrusted district, county, or city search text from the browser.
   * @returns a serializable success or stable provider failure.
   */
  async fetch(query: string): Promise<TeacherWeatherResult> {
    const parsedQuery = locationQuerySchema.safeParse(query)
    if (!parsedQuery.success) {
      return rejected('location-not-found', 'weather location must contain 1 to 80 characters')
    }

    try {
      const location = await this.resolveLocation(parsedQuery.data)
      if (location === undefined) {
        throw new WeatherProviderError('location-not-found', `weather location not found: ${parsedQuery.data}`)
      }
      return await this.fetchForecast(location)
    } catch (error) {
      if (error instanceof WeatherProviderError) return rejected(error.code, error.message)
      return rejected('invalid-response', errorMessage(error, 'weather provider returned an invalid response'))
    }
  }

  private resolveLocation(query: string): Promise<ResolvedWeatherLocation | undefined> {
    const cached = this.locationCache.get(query)
    if (cached !== undefined) {
      this.locationCache.delete(query)
      this.locationCache.set(query, cached)
      return cached
    }

    const pending = this.enqueueGeocoding(query)
    this.locationCache.set(query, pending)
    if (this.locationCache.size > this.geocodingCacheEntries) {
      const oldest = this.locationCache.keys().next().value as string
      this.locationCache.delete(oldest)
    }
    void pending.catch(() => {
      if (this.locationCache.get(query) === pending) this.locationCache.delete(query)
    })
    return pending
  }

  private enqueueGeocoding(query: string): Promise<ResolvedWeatherLocation | undefined> {
    const operation = this.geocodingTail.then(async () => {
      const remaining = this.lastGeocodingRequestAt + GEOCODING_REQUEST_INTERVAL_MS - this.now()
      if (remaining > 0) await this.wait(remaining)
      this.lastGeocodingRequestAt = this.now()
      return await this.requestLocation(query)
    })
    this.geocodingTail = operation.then(() => {}, () => {})
    return operation
  }

  private async requestLocation(query: string): Promise<ResolvedWeatherLocation | undefined> {
    const geocodingUrl = new URL(this.geocodingEndpoint)
    geocodingUrl.search = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      layer: 'address',
      limit: '1',
      dedupe: '1',
      'accept-language': 'zh-CN',
    }).toString()
    const results = geocodingSchema.parse(await requestJson(
      geocodingUrl,
      this.fetchImpl,
      { headers: { 'User-Agent': GEOCODING_USER_AGENT } },
    ))
    const first = results[0]
    if (first === undefined) return undefined
    const label = first.display_name
      .split(',')
      .map(part => part.trim())
      .filter((part, index, parts) => part !== '' && parts.indexOf(part) === index)
      .join(' · ')
    if (label === '') throw new WeatherProviderError('invalid-response', 'geocoder returned an empty location label')
    return Object.freeze({ label, latitude: first.lat, longitude: first.lon })
  }

  private async fetchForecast(location: ResolvedWeatherLocation): Promise<TeacherWeatherResult> {
    const forecastUrl = new URL(FORECAST_URL)
    forecastUrl.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
      ].join(','),
      hourly: ['temperature_2m', 'precipitation_probability', 'weather_code'].join(','),
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_probability_max',
        'sunrise',
        'sunset',
      ].join(','),
      timezone: 'auto',
      forecast_hours: '12',
    }).toString()
    const parsed = forecastSchema.parse(await requestJson(forecastUrl, this.fetchImpl))
    const hourCount = Math.min(
      12,
      parsed.hourly.time.length,
      parsed.hourly.temperature_2m.length,
      parsed.hourly.precipitation_probability.length,
      parsed.hourly.weather_code.length,
    )
    if (hourCount === 0) {
      throw new WeatherProviderError('invalid-response', 'weather response has no hourly forecast')
    }
    return accepted(Object.freeze({
      location: location.label,
      timezone: parsed.timezone,
      observedAt: parsed.current.time,
      temperature: parsed.current.temperature_2m,
      apparentTemperature: parsed.current.apparent_temperature,
      humidity: parsed.current.relative_humidity_2m,
      precipitation: parsed.current.precipitation,
      weatherCode: parsed.current.weather_code,
      windSpeed: parsed.current.wind_speed_10m,
      maximumTemperature: requiredForecastValue(parsed.daily.temperature_2m_max, 0),
      minimumTemperature: requiredForecastValue(parsed.daily.temperature_2m_min, 0),
      precipitationProbability: requiredForecastValue(parsed.daily.precipitation_probability_max, 0),
      sunrise: requiredForecastValue(parsed.daily.sunrise, 0),
      sunset: requiredForecastValue(parsed.daily.sunset, 0),
      hours: Object.freeze(Array.from({ length: hourCount }, (_, index) => Object.freeze({
        time: requiredForecastValue(parsed.hourly.time, index),
        temperature: requiredForecastValue(parsed.hourly.temperature_2m, index),
        weatherCode: requiredForecastValue(parsed.hourly.weather_code, index),
        precipitationProbability: requiredForecastValue(parsed.hourly.precipitation_probability, index),
      }))),
    }))
  }
}

async function requestJson(url: URL, fetchImpl: typeof fetch, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    throw new WeatherProviderError(
      'provider-unavailable',
      errorMessage(error, 'weather provider request failed'),
    )
  }
  if (!response.ok) {
    throw new WeatherProviderError('provider-unavailable', `weather provider returned HTTP ${response.status}`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new WeatherProviderError(
      'invalid-response',
      errorMessage(error, 'weather provider returned invalid JSON'),
    )
  }
}

function accepted(value: TeacherWeatherForecast): TeacherWeatherResult {
  return Object.freeze({ ok: true, value })
}

function rejected(code: TeacherWeatherErrorCode, message: string): TeacherWeatherResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function requiredForecastValue<T>(values: readonly T[], index: number): T {
  const value = values[index]
  /* v8 ignore next -- schemas and hourCount prove every requested forecast index exists. */
  if (value === undefined) throw new WeatherProviderError('invalid-response', 'weather forecast index is missing')
  return value
}
