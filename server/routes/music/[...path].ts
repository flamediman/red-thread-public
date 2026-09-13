import { serveMedia } from '../../utils/media'

export default defineEventHandler(event => serveMedia(event, 'music'))
