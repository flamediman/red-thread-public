import { networkInterfaces } from 'node:os'

function score(address: string): number {
  if (address.startsWith('192.168.')) return 100
  if (address.startsWith('10.')) return 80
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 70
  if (address.startsWith('100.')) return 20
  if (address.startsWith('198.18.') || address.startsWith('198.19.')) return 10
  if (address.startsWith('169.254.')) return 0
  return 40
}

export function lanAddresses(): string[] {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (score(net.address) === 0) continue
      found.push(net.address)
    }
  }
  return found.sort((a, b) => score(b) - score(a))
}

export function serverPort(): number {
  return Number(process.env.PORT || process.env.NUXT_PORT || 3000)
}

export function lanHost(): string {
  return process.env.HOST_IP?.trim() || lanAddresses()[0] || 'localhost'
}

export function joinUrl(): string {
  const forced = process.env.GAME_URL?.trim()
  if (forced) {
    const withScheme = /^https?:\/\//.test(forced) ? forced : `http://${forced}`
    const url = new URL(withScheme)
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/play'
    return url.toString().replace(/\/$/, '')
  }
  return `http://${lanHost()}:${serverPort()}/play`
}

/** Адрес мостовой сети Docker: снаружи по нему не подключиться. */
function isDockerBridge(address: string): boolean {
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address)
}

/** IP, который реально годится для телефонов, или null — тогда его вводят руками. */
export function usableHost(): string | null {
  const forced = process.env.HOST_IP?.trim()
  if (forced) return forced

  const fromUrl = process.env.GAME_URL?.trim()
  if (fromUrl) {
    try {
      return new URL(/^https?:\/\//.test(fromUrl) ? fromUrl : `http://${fromUrl}`).hostname
    } catch { /* пустой GAME_URL разберём ниже */ }
  }

  // внутри контейнера видно только мост — настоящий адрес хоста оттуда не узнать
  const real = lanAddresses().filter(a => !isDockerBridge(a) || !process.env.RUNNING_IN_DOCKER)
  return real[0] ?? null
}

export function addressIsGuess(): boolean {
  return !usableHost()
}
