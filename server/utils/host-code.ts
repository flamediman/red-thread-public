const DEFAULT_CODE = '0228'

let code: string | null = null

export function hostCode(): string {
  if (code) return code
  const fromEnv = process.env.HOST_CODE?.trim()
  const resolved = fromEnv && /^\d{4}$/.test(fromEnv) ? fromEnv : DEFAULT_CODE
  code = resolved
  return resolved
}

export function checkHostCode(input: unknown): boolean {
  return typeof input === 'string' && input.trim() === hostCode()
}
