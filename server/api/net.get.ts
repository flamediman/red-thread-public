import { joinUrl, lanAddresses, serverPort, usableHost } from '../utils/lan'
import { IS_PUBLIC } from '../utils/mode'

export default defineEventHandler(() => {
  // в сети адреса машины наружу не отдаём: телефоны идут по адресу сайта
  if (IS_PUBLIC) throw createError({ statusCode: 404 })
  return {
    url: joinUrl(),
    /** null — адрес надо ввести на экране ведущего */
    host: usableHost(),
    port: serverPort(),
    candidates: lanAddresses(),
    needsManualHost: !usableHost()
  }
})
