/* Реплики одиночной истории: обход всех сцен и разговоров в одном порядке — для озвучки и для клиента.
   Каждой реплике даётся id файла: <откуда>_<номер>. Один и тот же обход у инструмента озвучки и у движка,
   поэтому файл cases/<история>/voice/<id>.mp3 всегда соответствует реплике на экране. */
import type { SoloEffect, SoloLine, SoloStory } from '../../shared/types'

export interface VoiceLine { id: string; speaker: string; text: string; art?: string }

/** проставляет id репликам истории (идемпотентно) и возвращает их список */
export function assignVoiceIds(story: SoloStory): VoiceLine[] {
  const out: VoiceLine[] = []
  const scene = (prefix: string, lines?: SoloLine[]) => {
    lines?.forEach((l, i) => {
      l.id = `${prefix}_${i + 1}`
      out.push({ id: l.id, speaker: l.speaker, text: l.voice ?? l.text, art: l.art })
    })
  }
  const effect = (prefix: string, e?: SoloEffect) => scene(prefix, e?.scene)

  scene('pro', story.start.scene)
  for (const p of story.places) {
    effect(`enter_${p.id}`, p.enter)
    for (const x of p.exits) effect(`open_${p.id}_${x.to}`, x.lock?.open)
  }
  for (const h of story.hotspots) {
    effect(`look_${h.id}`, h.look)
    for (const u of h.use ?? []) effect(`use_${h.id}_${u.item}`, u.effect)
    effect(`solve_${h.id}`, h.puzzle?.success)
  }
  for (const d of story.dialogues) {
    for (const [node, n] of Object.entries(d.nodes)) {
      scene(`${d.id}_${node}`, n.lines)
      effect(`${d.id}_${node}_fx`, n.effect)
      n.choices?.forEach((c, i) => effect(`${d.id}_${node}_c${i + 1}`, c.effect))
    }
  }
  for (const c of story.chases ?? []) effect(`chase_${c.id}`, c.success)
  for (const e of story.endings) scene(`end_${e.id}`, e.scene)
  return out
}
