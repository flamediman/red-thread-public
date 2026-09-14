/* Мир «Туман»: одиночные истории. Конец восьмидесятых, закрытые города, туман, который не расходится.
   Бригады нет — один герой, один экран (компьютер или планшет). */
import type { SettingInfo } from '../../shared/types'

export const TUMAN: SettingInfo = {
  id: 'tuman',
  title: 'Туман',
  subtitle: 'Одиночная игра. Конец восьмидесятых, закрытый город у озера и туман, который не расходится.',
  theme: 'tuman',
  crew: 'герой',
  menu: { music: '/music/settings/tuman.mp3', ambience: { names: ['wind-haunted'], levels: { 'wind-haunted': 0.4 } } }
}
