// The only three IPC channels in the app. Everything is routed by name through
// the query/command registries, so adding a feature never adds a channel.
export const IPC = {
  QUERY: 'ay:query',
  COMMAND: 'ay:command',
  EVENT: 'ay:event'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
