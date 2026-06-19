import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/api/channels'
import type {
  ApiYesApi,
  CommandMap,
  CommandName,
  EventMap,
  EventName,
  QueryMap,
  QueryName
} from '@shared/api/contract'

type AnyListener = (name: EventName, payload: unknown) => void

const namedListeners = new Map<EventName, Set<(payload: unknown) => void>>()
const anyListeners = new Set<AnyListener>()

ipcRenderer.on(IPC.EVENT, (_e, msg: { name: EventName; payload: unknown }) => {
  namedListeners.get(msg.name)?.forEach((cb) => cb(msg.payload))
  anyListeners.forEach((cb) => cb(msg.name, msg.payload))
})

const api: ApiYesApi = {
  query<K extends QueryName>(name: K, input: QueryMap[K]['input']) {
    return ipcRenderer.invoke(IPC.QUERY, { name, input }) as Promise<QueryMap[K]['result']>
  },
  command<K extends CommandName>(name: K, input: CommandMap[K]['input']) {
    return ipcRenderer.invoke(IPC.COMMAND, { name, input }) as Promise<CommandMap[K]['result']>
  },
  on<K extends EventName>(name: K, cb: (payload: EventMap[K]) => void) {
    let set = namedListeners.get(name)
    if (!set) {
      set = new Set()
      namedListeners.set(name, set)
    }
    const wrapped = cb as (payload: unknown) => void
    set.add(wrapped)
    return () => set!.delete(wrapped)
  },
  onAny(cb: AnyListener) {
    anyListeners.add(cb)
    return () => anyListeners.delete(cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('platform', process.platform)
