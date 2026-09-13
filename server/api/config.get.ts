import { CLIENT_CONFIG } from '../utils/mode'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-cache')
  return CLIENT_CONFIG
})
