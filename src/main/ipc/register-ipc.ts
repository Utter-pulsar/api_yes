import { ipcMain } from 'electron'
import { IPC } from '@shared/api/channels'
import type { CommandName, QueryName } from '@shared/api/contract'
import type { AppCore } from '../services/context'

/**
 * Bridges the renderer to the in-process registries. Only two handlers exist —
 * every feature is addressed by name, so adding a feature never touches IPC.
 */
export function registerIpc(core: AppCore): void {
  ipcMain.handle(IPC.QUERY, async (_e, msg: { name: QueryName; input: unknown }) => {
    return core.queries.execute(msg.name, msg.input as never)
  })

  ipcMain.handle(IPC.COMMAND, async (_e, msg: { name: CommandName; input: unknown }) => {
    return core.commands.execute(msg.name, msg.input as never)
  })
}
