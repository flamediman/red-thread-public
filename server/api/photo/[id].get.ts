import { getPhoto } from '../../utils/photos'
import { IS_PUBLIC } from '../../utils/mode'

export default defineEventHandler((event) => {
  if (IS_PUBLIC) throw createError({ statusCode: 404 })
  const id = getRouterParam(event, 'id') || ''
  const photo = getPhoto(id)
  if (!photo) throw createError({ statusCode: 404, statusMessage: 'Фото нет' })

  setHeader(event, 'Content-Type', photo.type)
  setHeader(event, 'Cache-Control', 'private, max-age=86400')
  return photo.data
})
