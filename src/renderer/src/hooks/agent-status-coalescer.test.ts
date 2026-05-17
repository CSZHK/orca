import { describe, expect, it, vi } from 'vitest'
import { AgentStatusCoalescer } from './agent-status-coalescer'

type StatusEvent = {
  id: string
  paneKey: string
  connectionId: string | null
}

function createCoalescer(): AgentStatusCoalescer<StatusEvent, StatusEvent> {
  return new AgentStatusCoalescer<StatusEvent, StatusEvent>()
}

describe('AgentStatusCoalescer', () => {
  it('applies only the latest valid event for a pane in one flush', () => {
    const coalescer = createCoalescer()
    const apply = vi.fn()
    coalescer.enqueue('pane-1', { id: 'first', paneKey: 'pane-1', connectionId: null })
    coalescer.enqueue('pane-1', { id: 'second', paneKey: 'pane-1', connectionId: null })

    coalescer.flush((event) => event, apply)

    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith({ id: 'second', paneKey: 'pane-1', connectionId: null })
  })

  it('keeps an earlier valid event when a later connection event is invalid', () => {
    const coalescer = createCoalescer()
    const apply = vi.fn()
    coalescer.enqueue('pane-1', { id: 'valid-local', paneKey: 'pane-1', connectionId: null })
    coalescer.enqueue('pane-1', { id: 'stale-ssh', paneKey: 'pane-1', connectionId: 'ssh-stale' })

    coalescer.flush((event) => (event.connectionId === null ? event : null), apply)

    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith({
      id: 'valid-local',
      paneKey: 'pane-1',
      connectionId: null
    })
  })

  it('resolves validity at flush time after pane ownership changes', () => {
    const coalescer = createCoalescer()
    const apply = vi.fn()
    let currentConnectionId: string | null = 'ssh-1'
    coalescer.enqueue('pane-1', { id: 'old-owner', paneKey: 'pane-1', connectionId: 'ssh-1' })
    coalescer.enqueue('pane-1', { id: 'new-owner', paneKey: 'pane-1', connectionId: 'ssh-2' })

    currentConnectionId = 'ssh-2'
    coalescer.flush(
      (event) => (event.connectionId === currentConnectionId ? event : null),
      apply
    )

    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith({
      id: 'new-owner',
      paneKey: 'pane-1',
      connectionId: 'ssh-2'
    })
  })

  it('applies at most one event per pane in a flush', () => {
    const coalescer = createCoalescer()
    const apply = vi.fn()
    coalescer.enqueue('pane-1', { id: 'pane-1-first', paneKey: 'pane-1', connectionId: null })
    coalescer.enqueue('pane-1', { id: 'pane-1-second', paneKey: 'pane-1', connectionId: null })
    coalescer.enqueue('pane-2', { id: 'pane-2-first', paneKey: 'pane-2', connectionId: null })
    coalescer.enqueue('pane-2', { id: 'pane-2-second', paneKey: 'pane-2', connectionId: null })

    coalescer.flush((event) => event, apply)

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenNthCalledWith(1, {
      id: 'pane-1-second',
      paneKey: 'pane-1',
      connectionId: null
    })
    expect(apply).toHaveBeenNthCalledWith(2, {
      id: 'pane-2-second',
      paneKey: 'pane-2',
      connectionId: null
    })
  })
})
