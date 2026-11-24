// @usernames, checked the same way as the server (backend/src/validate.ts requireUsername).

/** "@Budi.S " → "budi.s" */
export const cleanUsername = (text: string) => text.trim().replace(/^@/, '').toLowerCase()

/** What's wrong with this username, in plain words, or null when it's fine. */
export function usernameProblem(text: string): string | null {
  const u = cleanUsername(text)
  if (u.length < 3) return 'At least 3 characters.'
  if (u.length > 20) return 'At most 20 characters.'
  if (!/^[a-z0-9_.]+$/.test(u)) return 'Only letters, numbers, "_" and ".".'
  if (!/^[a-z0-9]/.test(u)) return 'Start with a letter or a number.'
  return null
}
