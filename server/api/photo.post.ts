import { savePhoto, MAX_PHOTO_BYTES } from '../utils/photos'
import { IS_PUBLIC } from '../utils/mode'
import { LOCAL_ROOM, getRoom } from '../utils/rooms'

export default defineEventHandler(async (event) => {
  // фото игроков — только дома: в сети персональные данные не собираем и не храним
  if (IS_PUBLIC) throw createError({ statusCode: 404 })
  if (Number(getRequestHeader(event, 'content-length') || 0) > MAX_PHOTO_BYTES * 1.5) {
    throw createError({ statusCode: 413, statusMessage: 'Снимок слишком большой' })
  }
  const body = await readBody<{ token?: string; dataUrl?: string }>(event)
  if (!body?.token || !body?.dataUrl || typeof body.token !== 'string' || typeof body.dataUrl !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Нужны токен и снимок' })
  }
  if (body.dataUrl.length > MAX_PHOTO_BYTES * 1.4) {
    throw createError({ statusCode: 413, statusMessage: 'Снимок слишком большой' })
  }

  const game = getRoom(LOCAL_ROOM)?.game
  const player = game?.byToken(body.token)
  if (!game || !player) throw createError({ statusCode: 403, statusMessage: 'Игрок не найден' })

  if (!savePhoto(player.id, player.token, body.dataUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'Не похоже на картинку' })
  }

  const version = game.markPhoto(player.id)
  return { ok: true, version }
})
