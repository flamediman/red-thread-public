/* Ограничители против перебора и флуда. Всё в памяти процесса: один сервер — одна таблица. */

/** Скользящее окно: не больше max событий за windowMs на ключ (обычно — IP). */
export class WindowLimiter {
  private hits = new Map<string, number[]>()
  constructor(private max: number, private windowMs: number) {
    const t = setInterval(() => this.sweep(), Math.max(10_000, windowMs))
    t.unref?.()
  }

  /** true — можно; событие засчитывается */
  take(key: string): boolean {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs)
    if (list.length >= this.max) { this.hits.set(key, list); return false }
    list.push(now)
    this.hits.set(key, list)
    return true
  }

  /** не засчитывая, проверить, не исчерпан ли лимит */
  blocked(key: string): boolean {
    const now = Date.now()
    return (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs).length >= this.max
  }

  private sweep() {
    const now = Date.now()
    for (const [k, list] of this.hits) {
      const fresh = list.filter(t => now - t < this.windowMs)
      if (fresh.length) this.hits.set(k, fresh)
      else this.hits.delete(k)
    }
  }
}

/** Ведро жетонов на одно соединение: ровный поток сообщений с запасом на всплеск. */
export class Bucket {
  private tokens: number
  private at = Date.now()
  constructor(private perSecond: number, private burst: number) { this.tokens = burst }
  take(): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSecond)
    this.at = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
