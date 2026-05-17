export type AgentStatusUpdateResolver<TEvent, TUpdate> = (event: TEvent) => TUpdate | null
export type AgentStatusUpdateApplier<TUpdate> = (update: TUpdate) => void

export class AgentStatusCoalescer<TEvent, TUpdate> {
  private readonly pendingByPaneKey = new Map<string, TEvent[]>()

  enqueue(paneKey: string, event: TEvent): void {
    const events = this.pendingByPaneKey.get(paneKey)
    if (events) {
      events.push(event)
      return
    }
    this.pendingByPaneKey.set(paneKey, [event])
  }

  flush(
    resolve: AgentStatusUpdateResolver<TEvent, TUpdate>,
    apply: AgentStatusUpdateApplier<TUpdate>
  ): void {
    const batch = Array.from(this.pendingByPaneKey.values())
    this.pendingByPaneKey.clear()
    for (const events of batch) {
      const update = resolveLatestValidAgentStatusUpdate(events, resolve)
      if (update !== null) {
        apply(update)
      }
    }
  }

  clear(): void {
    this.pendingByPaneKey.clear()
  }
}

export function resolveLatestValidAgentStatusUpdate<TEvent, TUpdate>(
  events: readonly TEvent[],
  resolve: AgentStatusUpdateResolver<TEvent, TUpdate>
): TUpdate | null {
  // Why: validity is evaluated at flush time so a later stale SSH event cannot
  // overwrite an earlier event that still matches the pane's current owner.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const update = resolve(events[index])
    if (update !== null) {
      return update
    }
  }
  return null
}
