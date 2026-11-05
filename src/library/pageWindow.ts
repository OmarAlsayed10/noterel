export function libraryPageWindow(page: number, pageSize: number, phoneTotal: number) {
  const start = page * pageSize
  const phoneLimit = Math.min(pageSize, Math.max(0, phoneTotal - start))
  return {
    phone: { offset: start, limit: phoneLimit },
    desktop: { offset: Math.max(0, start - phoneTotal), limit: pageSize - phoneLimit }
  }
}
