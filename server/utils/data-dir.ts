import { resolve } from 'node:path'

/** Куда складываем то, что должно пережить перезапуск: фото и историю партий. */
export const DATA_DIR = process.env.DATA_DIR || resolve(process.cwd(), '.data')
