/** Local startup page shown while the desktop backend starts. */

const COPY = {
  en: 'Starting DSH Teacher',
  zh: '正在启动 DSH Teacher',
} as const satisfies Record<'en' | 'zh', string>

/**
 * Build the script-free data URL used before the private Web origin is ready.
 * @param locale - Electron application locale.
 * @returns a self-contained page URL with English or Simplified Chinese copy.
 */
export function startupPageUrl(locale: string): string {
  const language = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const heading = COPY[language]
  const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="color-scheme" content="light dark">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DSH Teacher</title>
  <style>
    :root { font-family: Inter, "Segoe UI", system-ui, sans-serif; color: #202124; background: #f7f8fa; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { display: grid; justify-items: center; gap: 18px; padding: 32px; text-align: center; }
    .spinner { width: 40px; height: 40px; border: 4px solid #d9dde5; border-top-color: #4d6bfe; border-radius: 50%; animation: spin .9s linear infinite; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-color-scheme: dark) {
      :root { color: #f4f4f5; background: #151517; }
      .spinner { border-color: #3f3f46; border-top-color: #8ea1ff; }
    }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.8s; } }
  </style>
</head>
<body>
  <main role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <h1>${heading}</h1>
  </main>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
