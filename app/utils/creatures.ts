/* Как звучат существа «Тумана» вокруг героя: шаги, пока подходит (бродячее — приёмник уже шипит), и голос рядом во время
   встречи. Звуки идут через useAudio.spatial — с направлением и расстоянием, поэтому существо слышно то слева, то за
   спиной, всё ближе. Неизвестное существо звучит шагами и шёпотом */
export interface CreatureVoice {
  /** как оно подходит: шаги или то, что их заменяет (шлёпанье, шелест бумаги) */
  steps: string
  /** голос вблизи: дыхание, горн, бульканье — по очереди */
  near: string[]
}

export const CREATURES: Record<string, CreatureVoice> = {
  bugler: { steps: 'footsteps-behind', near: ['bugler-wheeze', 'bugle-near', 'bugler-wheeze'] },
  wet: { steps: 'wet-near', near: ['wet-gurgle', 'wet-near', 'wet-gurgle'] },
  postman: { steps: 'paper', near: ['whisper-near', 'paper'] },
  counselor: { steps: 'footsteps-behind', near: ['whistle-near', 'footsteps-behind'] },
  sleeper: { steps: 'thud-cloth', near: ['whisper-near', 'thud-cloth'] },
  squad: { steps: 'footsteps-behind', near: ['whisper-near', 'step-tile'] },
  diver: { steps: 'helmet-clang', near: ['diver-breath', 'helmet-clang'] }
}

export const creatureVoice = (id: string): CreatureVoice => CREATURES[id] ?? { steps: 'footsteps-behind', near: ['whisper-near'] }
