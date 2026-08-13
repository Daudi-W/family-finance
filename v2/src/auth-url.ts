export function canonicalAuthUrl(currentUrl: string, authDomain: string) {
  if (!authDomain) return ''
  const current = new URL(currentUrl)
  if (!current.hostname.endsWith('.web.app') || current.hostname === authDomain) return ''
  current.protocol = 'https:'
  current.hostname = authDomain
  current.port = ''
  return current.toString()
}
