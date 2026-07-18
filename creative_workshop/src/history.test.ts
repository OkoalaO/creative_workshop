import { describe, expect, it } from 'vitest'
import { upsertHistoryItem } from './history'

describe('history updates', () => {
  it('updates an existing long-running task without duplicating it', () => {
    const history = [{ id: 'task-1', status: 'RUNNING' }]
    expect(upsertHistoryItem(history, { id: 'task-1', status: 'SUCCESS' })).toEqual([
      { id: 'task-1', status: 'SUCCESS' },
    ])
  })

  it('does not restore a task that the user already removed', () => {
    expect(upsertHistoryItem([], { id: 'task-1', status: 'SUCCESS' }, false)).toEqual([])
  })
})
