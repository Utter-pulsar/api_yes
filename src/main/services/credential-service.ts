import { randomUUID } from 'node:crypto'
import type { CredentialView } from '@shared/types'
import type { AppCore } from './context'
import { toCredentialView, type StoredCredential } from './store'
import { fetchUsage, listModels, testCredential } from './provider/upstream'
import { mt } from './i18n'

function views(core: AppCore): CredentialView[] {
  return core.store.data.credentials
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(toCredentialView)
}

function broadcastCredentials(core: AppCore): void {
  // emit (not broadcast) so main-side listeners — e.g. the proxy server reacting to an exposure
  // change — fire too; context.ts mirrors every event to the renderer, so the UI still updates.
  core.events.emit('credentials.changed', views(core))
}

function broadcastProxies(core: AppCore): void {
  core.broadcast(
    'proxies.changed',
    core.store.data.proxies.slice().sort((a, b) => a.order - b.order)
  )
}

/** Registers all credential query/command handlers. The OAuth-creation path lives in oauth-service. */
export function registerCredentialService(core: AppCore): void {
  core.queries.register('credentials.list', () => views(core))
  core.queries.register('credentials.get', ({ id }) => {
    const c = core.store.data.credentials.find((x) => x.id === id)
    return c ? toCredentialView(c) : null
  })

  core.commands.register('credentials.createApiKey', (input) => {
    const now = Date.now()
    const order = core.store.data.credentials.reduce((m, c) => Math.max(m, c.order), -1) + 1
    const cred: StoredCredential = {
      id: randomUUID(),
      name: input.name.trim() || mt('name.providerCred', { provider: input.provider }),
      provider: input.provider,
      kind: 'apikey',
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey.trim(),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      order
    }
    core.store.mutate((db) => db.credentials.push(cred))
    broadcastCredentials(core)
    return toCredentialView(cred)
  })

  core.commands.register('credentials.update', ({ id, patch }) => {
    let updated: StoredCredential | undefined
    core.store.mutate((db) => {
      const c = db.credentials.find((x) => x.id === id)
      if (!c) return
      if (patch.name !== undefined) c.name = patch.name.trim() || c.name
      if (patch.baseUrl !== undefined) c.baseUrl = patch.baseUrl.trim()
      if (patch.apiKey !== undefined && patch.apiKey.trim()) c.apiKey = patch.apiKey.trim()
      if (patch.enabled !== undefined) c.enabled = patch.enabled
      c.updatedAt = Date.now()
      updated = c
    })
    if (!updated) throw new Error(mt('err.credNotFound'))
    broadcastCredentials(core)
    return toCredentialView(updated)
  })

  core.commands.register('credentials.delete', ({ id }) => {
    let removedProxies = false
    core.store.mutate((db) => {
      db.credentials = db.credentials.filter((c) => c.id !== id)
      const before = db.proxies.length
      db.proxies = db.proxies.filter((p) => p.credentialId !== id)
      removedProxies = db.proxies.length !== before
    })
    broadcastCredentials(core)
    if (removedProxies) broadcastProxies(core)
  })

  core.commands.register('credentials.reorder', ({ orderedIds }) => {
    core.store.mutate((db) => {
      orderedIds.forEach((id, i) => {
        const c = db.credentials.find((x) => x.id === id)
        if (c) c.order = i
      })
    })
    broadcastCredentials(core)
  })

  core.commands.register('credentials.test', async ({ id }) => {
    const c = core.store.data.credentials.find((x) => x.id === id)
    if (!c) throw new Error(mt('err.credNotFound'))
    const result = await testCredential(core, c)
    core.store.mutate((db) => {
      const x = db.credentials.find((y) => y.id === id)
      if (x) x.lastTest = result
    })
    broadcastCredentials(core)
    return result
  })

  core.commands.register('credentials.testDraft', async ({ draft }) => {
    const ephemeral: StoredCredential = {
      id: randomUUID(),
      name: draft.name,
      provider: draft.provider,
      kind: 'apikey',
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      createdAt: 0,
      updatedAt: 0,
      order: 0
    }
    return testCredential(core, ephemeral)
  })

  core.commands.register('credentials.listModels', async ({ id }) => {
    const c = core.store.data.credentials.find((x) => x.id === id)
    if (!c) throw new Error(mt('err.credNotFound'))
    return listModels(core, c)
  })

  core.commands.register('credentials.usage', async ({ id }) => {
    const c = core.store.data.credentials.find((x) => x.id === id)
    if (!c) throw new Error(mt('err.credNotFound'))
    return fetchUsage(core, c)
  })
}
