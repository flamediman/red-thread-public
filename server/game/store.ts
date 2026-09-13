/* Где живёт снимок партии и история дел одной комнаты.
   Движок не знает, дома он или в сети: снимок пишется с задержкой (партия меняется десятки раз в минуту),
   история — сразу. */
import type { GameRecord } from '../../shared/types'

export interface GameStore {
  /** последний снимок партии или null */
  load(): unknown | null
  /** новый снимок: запишется чуть позже, последний побеждает */
  save(data: object): void
  /** дописать отложенный снимок немедленно */
  flush(): void
  history(): GameRecord[]
  addHistory(record: GameRecord): void
  log(text: string): void
}
