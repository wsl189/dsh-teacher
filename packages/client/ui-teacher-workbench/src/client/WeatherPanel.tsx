/** Header time-and-weather summary with an expanded forecast panel. */

import { useEffect, useState } from 'react'
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  MapPin,
  Maximize2,
  Minimize2,
  RefreshCw,
  Snowflake,
  Sun,
} from 'lucide-react'
import {
  TeacherWeatherError,
  weatherCondition,
  type TeacherWeatherForecast,
} from './weather.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Time-and-weather panel props. */
export interface WeatherPanelProps {
  /** Whether the detailed panel occupies the full daily-management area. */
  expanded: boolean
  /** Configured weather location query. */
  location: string
  /** Expand the panel. */
  onExpand: () => void
  /** Return to the daily-management dashboard. */
  onCollapse: () => void
  /** Persist a normalized location query through dsh settings. */
  onSaveLocation: (location: string) => Promise<void>
  /** Load validated weather through the DSH Host. */
  loadWeather: (location: string, signal?: AbortSignal) => Promise<TeacherWeatherForecast>
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render current time and weather with a twelve-hour expanded forecast.
 * @param props - expansion state, location setting, commands, and copy.
 * @returns the header summary or detailed weather panel.
 */
export function WeatherPanel(props: WeatherPanelProps) {
  const [now, setNow] = useState(() => new Date())
  const [activeLocation, setActiveLocation] = useState(props.location)
  const [locationDraft, setLocationDraft] = useState(props.location)
  const [weather, setWeather] = useState<TeacherWeatherForecast | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorCode, setErrorCode] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => { setNow(new Date()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    setActiveLocation(props.location)
    setLocationDraft(props.location)
  }, [props.location])
  useEffect(() => {
    if (activeLocation.trim() === '') {
      setWeather(null)
      setStatus('idle')
      setErrorCode('')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setErrorCode('')
    void props.loadWeather(activeLocation, controller.signal).then((forecast) => {
      setWeather(forecast)
      setStatus('ready')
    }, (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWeather(null)
      setStatus('error')
      /* v8 ignore else -- loadWeather rejects only with TeacherWeatherError or AbortError. */
      if (error instanceof TeacherWeatherError) setErrorCode(error.code)
      else setErrorCode('provider-unavailable')
    })
    return () => { controller.abort() }
  }, [activeLocation, props.loadWeather, refresh])

  const saveLocation = async (): Promise<void> => {
    const normalized = locationDraft.trim()
    if (normalized === '') return
    try {
      await props.onSaveLocation(normalized)
      if (normalized === activeLocation) setRefresh(current => current + 1)
      else setActiveLocation(normalized)
    } catch {
      setStatus('error')
      setErrorCode('provider-unavailable')
    }
  }
  if (!props.expanded) {
    return (
      <button
        type="button"
        className={css.weatherHeadingButton}
        aria-label={props.t('daily.weather.details')}
        title={props.t('daily.weather.details')}
        data-daily-weather-summary
        onClick={props.onExpand}
      >
        <span className={css.weatherHeadingClock} aria-live="off">
          <strong>{formatClock(now)}</strong>
          <small>{formatDate(now)}</small>
        </span>
        <span className={css.weatherHeadingDivider} aria-hidden="true" />
        <WeatherHeadingSummary
          weather={weather}
          status={status}
          errorCode={errorCode}
          location={activeLocation}
          t={props.t}
        />
        <Maximize2 size={16} aria-hidden="true" />
      </button>
    )
  }
  const toggleLabel = props.t('daily.panel.collapse')
  return (
    <section className={`${css.dailyPanel} ${css.weatherPanel} ${css.dailyPanelExpanded}`} aria-labelledby="daily-weather-title">
      <header className={css.dailyPanelHeader}>
        <div>
          <h2 id="daily-weather-title">{props.t('daily.weather.title')}</h2>
          <span>{weather?.location ?? (activeLocation || props.t('daily.weather.unconfigured'))}</span>
        </div>
        <button
          type="button"
          className={css.dailyIconButton}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={props.onCollapse}
        >
          <Minimize2 size={16} />
        </button>
      </header>
      <div className={css.weatherExpandedBody}>
        <div className={css.liveClock} aria-live="off">
          <div><strong>{formatClock(now)}</strong><span aria-hidden="true">{formatSeconds(now)}</span></div>
          <p>{formatDate(now)}</p>
        </div>
        <WeatherSummary weather={weather} status={status} errorCode={errorCode} t={props.t} />
        <div className={css.weatherDetails}>
          <form className={css.weatherSearch} onSubmit={(event) => { event.preventDefault(); void saveLocation() }}>
            <MapPin size={16} />
            <input
              aria-label={props.t('daily.weather.location')}
              maxLength={80}
              value={locationDraft}
              placeholder={props.t('daily.weather.locationPlaceholder')}
              onChange={(event) => { setLocationDraft(event.target.value) }}
            />
            <button type="submit" className={css.buttonPrimary} disabled={locationDraft.trim() === '' || status === 'loading'}>
              {props.t('daily.weather.query')}
            </button>
            <button
              type="button"
              className={css.dailyIconButton}
              aria-label={props.t('daily.weather.refresh')}
              title={props.t('daily.weather.refresh')}
              disabled={activeLocation === '' || status === 'loading'}
              onClick={() => { setRefresh(current => current + 1) }}
            >
              <RefreshCw size={16} />
            </button>
          </form>
          {weather !== null && (
            <>
              <div className={css.weatherMetrics}>
                <WeatherMetric label={props.t('daily.weather.feelsLike')} value={`${round(weather.apparentTemperature)}°`} />
                <WeatherMetric label={props.t('daily.weather.humidity')} value={`${round(weather.humidity)}%`} />
                <WeatherMetric label={props.t('daily.weather.wind')} value={`${round(weather.windSpeed)} km/h`} />
                <WeatherMetric label={props.t('daily.weather.precipitation')} value={`${weather.precipitation} mm`} />
                <WeatherMetric label={props.t('daily.weather.sunrise')} value={formatProviderTime(weather.sunrise)} />
                <WeatherMetric label={props.t('daily.weather.sunset')} value={formatProviderTime(weather.sunset)} />
              </div>
              <section className={css.hourlySection} aria-labelledby="weather-hourly-title">
                <div className={css.hourlyHeading}>
                  <h3 id="weather-hourly-title">{props.t('daily.weather.next12Hours')}</h3>
                  <span>{weather.timezone}</span>
                </div>
                <div className={css.hourlyForecast}>
                  {weather.hours.map(hour => (
                    <article key={hour.time}>
                      <time>{formatProviderTime(hour.time)}</time>
                      <WeatherGlyph code={hour.weatherCode} size={20} />
                      <strong>{round(hour.temperature)}°</strong>
                      <span>{hour.precipitationProbability}%</span>
                    </article>
                  ))}
                </div>
              </section>
              <div className={css.weatherAttributions}>
                <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                  {props.t('daily.weather.attribution')}
                </a>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  {props.t('daily.weather.locationAttribution')}
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function WeatherHeadingSummary(props: {
  weather: TeacherWeatherForecast | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorCode: string
  location: string
  t: TeacherWorkbenchTranslate
}) {
  if (props.status === 'idle') {
    return (
      <span className={css.weatherHeadingState} aria-live="polite">
        <MapPin size={18} />
        <span>{props.t('daily.weather.unconfigured')}</span>
      </span>
    )
  }
  if (props.status === 'loading') {
    return (
      <span className={css.weatherHeadingState} aria-live="polite">
        <RefreshCw className={css.spinning} size={18} />
        <span>{props.t('daily.weather.loading')}</span>
      </span>
    )
  }
  if (props.weather === null) {
    return (
      <span className={css.weatherHeadingState} aria-live="polite">
        <Cloud size={18} />
        <span>{weatherErrorLabel(props.t, props.errorCode)}</span>
        {props.location !== '' && <small>{props.location}</small>}
      </span>
    )
  }
  return (
    <span className={css.weatherHeadingForecast} aria-live="polite">
      <WeatherGlyph code={props.weather.weatherCode} size={18} />
      <strong>{round(props.weather.temperature)}°</strong>
      <span>{weatherCondition(props.weather.weatherCode)}</span>
      <small>{props.weather.location}</small>
    </span>
  )
}

function WeatherSummary(props: {
  weather: TeacherWeatherForecast | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorCode: string
  t: TeacherWorkbenchTranslate
}) {
  if (props.status === 'idle') {
    return <div className={css.weatherState}><MapPin size={22} /><span>{props.t('daily.weather.configure')}</span></div>
  }
  if (props.status === 'loading') {
    return <div className={css.weatherState} role="status"><RefreshCw className={css.spinning} size={22} /><span>{props.t('daily.weather.loading')}</span></div>
  }
  if (props.weather === null) {
    return <div className={css.weatherState} role="alert"><Cloud size={22} /><span>{weatherErrorLabel(props.t, props.errorCode)}</span></div>
  }
  const weather = props.weather
  return (
    <div className={css.weatherSummary} aria-live="polite">
      <WeatherGlyph code={weather.weatherCode} size={40} />
      <strong>{round(weather.temperature)}°</strong>
      <div>
        <b>{weatherCondition(weather.weatherCode)}</b>
        <span>{props.t('daily.weather.range', { high: round(weather.maximumTemperature), low: round(weather.minimumTemperature) })}</span>
        <small>{props.t('daily.weather.rainChance', { value: round(weather.precipitationProbability) })}</small>
      </div>
    </div>
  )
}

function weatherErrorLabel(t: TeacherWorkbenchTranslate, errorCode: string): string {
  return errorCode === 'location-not-found'
    ? t('daily.weather.locationNotFound')
    : errorCode === 'invalid-response'
      ? t('daily.weather.invalidResponse')
      : t('daily.weather.unavailable')
}

function WeatherMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}

function WeatherGlyph({ code, size }: { code: number; size: number }) {
  if (code === 0) return <Sun size={size} />
  if (code === 1 || code === 2) return <CloudSun size={size} />
  if (code === 3) return <Cloud size={size} />
  if (code === 45 || code === 48) return <CloudFog size={size} />
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <Snowflake size={size} />
  if ([95, 96, 99].includes(code)) return <CloudLightning size={size} />
  return <CloudRain size={size} />
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatSeconds(date: Date): string {
  return date.toLocaleTimeString([], { second: '2-digit' })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function formatProviderTime(value: string): string {
  return value.split('T')[1]?.slice(0, 5) ?? value
}

function round(value: number): number {
  return Math.round(value)
}
