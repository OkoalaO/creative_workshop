export function upsertHistoryItem<T extends { id: string }>(
  history: T[],
  item: T,
  allowInsert = true,
  limit = 30,
) {
  const exists = history.some((historyItem) => historyItem.id === item.id)
  if (!exists && !allowInsert) return history
  return [item, ...history.filter((historyItem) => historyItem.id !== item.id)].slice(0, limit)
}
