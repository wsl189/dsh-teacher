/** Remote-backed weather loading and presentation helpers for daily management. */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TeacherWeatherErrorCode,
  TeacherWeatherForecast,
  TeacherWeatherRequest,
  TeacherWeatherResult,
} from '@deepseek-ai/dsh-api-remotes/client'

export type {
  TeacherWeatherErrorCode,
  TeacherWeatherForecast,
  TeacherWeatherHour,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Generated Remote fields needed to load teacher-workbench weather. */
export interface TeacherWeatherRemote {
  /** Fetch validated weather through the DSH Host. */
  weather: (request: TeacherWeatherRequest) => Promise<RemoteResult<TeacherWeatherResult>>
}

/** Weather-loading failure with a user-presentable stable code. */
export class TeacherWeatherError extends Error {
  /**
   * @param code - stable failure code.
   * @param message - diagnostic for logs and tests.
   */
  constructor(readonly code: TeacherWeatherErrorCode, message: string) {
    super(message)
    this.name = 'TeacherWeatherError'
  }
}

/**
 * Load current conditions and twelve forecast hours through the DSH Host.
 * @param location - non-empty district, county, or city search text.
 * @param remote - generated teacher-workbench Remote namespace.
 * @param signal - optional UI cancellation signal.
 * @returns validated weather data in the provider's local timezone.
 * @throws {@link TeacherWeatherError} when the Remote or provider rejects the lookup.
 */
export async function fetchTeacherWeather(
  location: string,
  remote: TeacherWeatherRemote,
  signal?: AbortSignal,
): Promise<TeacherWeatherForecast> {
  let carried: RemoteResult<TeacherWeatherResult>
  try {
    carried = await abortable(remote.weather({ location }), signal)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new TeacherWeatherError(
      'provider-unavailable',
      error instanceof Error ? error.message : 'teacher weather Remote failed',
    )
  }
  if (!carried.ok) {
    throw new TeacherWeatherError('provider-unavailable', carried.error.message)
  }
  if (!carried.value.ok) {
    throw new TeacherWeatherError(carried.value.error.code, carried.value.error.message)
  }
  return carried.value.value
}

/**
 * Convert a WMO weather code to concise Simplified Chinese.
 * @param code - WMO weather interpretation code.
 * @returns compact condition label.
 */
export function weatherCondition(code: number): string {
  if (code === 0) return '晴'
  if (code === 1 || code === 2) return '少云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '有雾'
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '有雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '有雪'
  if ([95, 96, 99].includes(code)) return '雷雨'
  return '天气变化'
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) throw abortError()
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

function abortError(): DOMException {
  return new DOMException('The weather request was aborted', 'AbortError')
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError'
}
