// A tiny strongly-typed pub/sub emitter. Used in main to publish business events
// (forwarded to the renderer windows) and in the renderer for local fan-out.

export type Listener<T> = (payload: T) => void

export class TypedEmitter<EventMap extends Record<string, unknown>> {
  private map = new Map<keyof EventMap, Set<Listener<unknown>>>()
  private anyListeners = new Set<(name: keyof EventMap, payload: unknown) => void>()

  on<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): () => void {
    let set = this.map.get(event)
    if (!set) {
      set = new Set()
      this.map.set(event, set)
    }
    set.add(fn as Listener<unknown>)
    return () => this.off(event, fn)
  }

  off<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): void {
    this.map.get(event)?.delete(fn as Listener<unknown>)
  }

  /** Subscribe to every event. */
  onAny(fn: (name: keyof EventMap, payload: unknown) => void): () => void {
    this.anyListeners.add(fn)
    return () => this.anyListeners.delete(fn)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.map.get(event)?.forEach((fn) => fn(payload))
    this.anyListeners.forEach((fn) => fn(event, payload))
  }
}
