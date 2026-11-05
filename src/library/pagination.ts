export function requestedPageIndex(value: string, totalPages: number): number | null {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(totalPages) || totalPages < 1) return null
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 1 && page <= totalPages ? page - 1 : null
}
