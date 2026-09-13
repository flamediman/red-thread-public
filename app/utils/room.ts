/** «ABCDEF» → «ABC DEF»: так код комнаты легче прочитать с экрана и продиктовать */
export const formatRoom = (code: string | null | undefined) => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : '')
