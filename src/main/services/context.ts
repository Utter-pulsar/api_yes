import { TypedEmitter } from '@shared/bus/event-bus'
import { Registry } from '@shared/bus/registry'
import type { CommandMap, EventMap, QueryMap } from '@shared/api/contract'
import type { Store } from './store'
import { setMainLang } from './i18n'

/**
 * The application core wires together the substrates every feature uses:
 *   store     — persistence
 *   events    — business events (also forwarded to renderer windows)
 *   queries   — read API surface
 *   commands  — write/action API surface
 *
 * Services register handlers on `queries`/`commands` and publish on `events`.
 */
export interface AppCore {
  store: Store
  events: TypedEmitter<EventMap>
  queries: Registry<QueryMap>
  commands: Registry<CommandMap>
  /** Send an event to all renderer windows. Wired by the WindowManager at startup. */
  broadcast<K extends keyof EventMap>(name: K, payload: EventMap[K]): void
}

export function createAppCore(store: Store): AppCore {
  // seed the main-process language from persisted settings (the renderer mirrors it here on switch)
  setMainLang(store.data.settings.lang)
  const events = new TypedEmitter<EventMap>()
  const core: AppCore = {
    store,
    events,
    queries: new Registry<QueryMap>(),
    commands: new Registry<CommandMap>(),
    broadcast: () => {} // replaced once windows exist
  }
  // Every emitted business event is mirrored to the renderer windows.
  events.onAny((name, payload) => core.broadcast(name as keyof EventMap, payload as never))
  return core
}
