import { randomUUID } from 'node:crypto'
import type { CredentialView } from '@shared/types'
import type { AppCore } from './context'
import { getCredentialNode } from './usage-history'
import {
  getSameApiKeyInfo,
  normalizeSameApiKeyState,
  toCredentialView,
  type StoredCredential
} from './store'
import { fetchUsage, listModels, testCredential } from './provider/upstream'
import { mt } from './i18n'

function views(core: AppCore): CredentialView[] {
  const credentials = core.store.data.credentials.slice().sort((a, b) => a.order - b.order)
  return credentials.map((c) => toCredentialView(c, credentials))
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

function sameApiKeyView(core: AppCore, id: string): CredentialView {
  const credentials = core.store.data.credentials.slice().sort((a, b) => a.order - b.order)
  const c = credentials.find((x) => x.id === id)
  if (!c) throw new Error(mt('err.credNotFound'))
  return toCredentialView(c, credentials)
}

/** Registers all credential query/command handlers. The OAuth-creation path lives in oauth-service. */
export function registerCredentialService(core: AppCore): void {
  core.queries.register('credentials.list', () => views(core))
  core.queries.register('credentials.get', ({ id }) => {
    const c = core.store.data.credentials.find((x) => x.id === id)
    return c ? toCredentialView(c, core.store.data.credentials) : null
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
    core.store.mutate((db) => {
      db.credentials.push(cred)
      normalizeSameApiKeyState(db.credentials)
    })
    broadcastCredentials(core)
    return sameApiKeyView(core, cred.id)
  })

  core.commands.register('credentials.update', ({ id, patch }) => {
    let updated: StoredCredential | undefined
    core.store.mutate((db) => {
      const c = db.credentials.find((x) => x.id === id)
      if (!c) return
      if (patch.name !== undefined) {
        c.name = patch.name.trim() || c.name
        // keep the history record's display name in step with the live entity
        const node = getCredentialNode(db.usageHistory, id)
        if (node) node.name = c.name
      }
      if (patch.baseUrl !== undefined) c.baseUrl = patch.baseUrl.trim()
      if (patch.apiKey !== undefined && patch.apiKey.trim()) c.apiKey = patch.apiKey.trim()
      if (patch.enabled !== undefined) c.enabled = patch.enabled
      c.updatedAt = Date.now()
      updated = c
      normalizeSameApiKeyState(db.credentials)
    })
    if (!updated) throw new Error(mt('err.credNotFound'))
    broadcastCredentials(core)
    return sameApiKeyView(core, id)
  })

  core.commands.register('credentials.setSameApiKeyMode', ({ id, enabled }) => {
    core.store.mutate((db) => {
      const c = db.credentials.find((x) => x.id === id)
      if (!c) throw new Error(mt('err.credNotFound'))
      const info = getSameApiKeyInfo(c, db.credentials)
      if (!info?.duplicated) throw new Error(mt('err.sameKeyNotDuplicated'))
      const key = c.apiKey?.trim()
      if (!key) throw new Error(mt('err.sameKeyNotDuplicated'))
      const group = db.credentials.filter((x) => x.kind === 'apikey' && x.apiKey?.trim() === key)
      for (const member of group) {
        if (enabled) {
          member.sameApiKeyMode = true
          member.sameApiKeyActive = member.id === id
        } else {
          delete member.sameApiKeyMode
          delete member.sameApiKeyActive
        }
      }
      normalizeSameApiKeyState(db.credentials)
    })
    broadcastCredentials(core)
    return sameApiKeyView(core, id)
  })

  core.commands.register('credentials.setSameApiKeyActive', ({ id, active }) => {
    core.store.mutate((db) => {
      const c = db.credentials.find((x) => x.id === id)
      if (!c) throw new Error(mt('err.credNotFound'))
      const info = getSameApiKeyInfo(c, db.credentials)
      if (!info?.duplicated || !info.modeEnabled) throw new Error(mt('err.sameKeyModeOff'))
      const key = c.apiKey?.trim()
      if (!key) throw new Error(mt('err.sameKeyModeOff'))
      const group = db.credentials.filter((x) => x.kind === 'apikey' && x.apiKey?.trim() === key)
      for (const member of group) member.sameApiKeyActive = active ? member.id === id : false
      normalizeSameApiKeyState(db.credentials)
    })
    broadcastCredentials(core)
    return sameApiKeyView(core, id)
  })

  core.commands.register('credentials.delete', ({ id }) => {
    let removedProxies = false
    core.store.mutate((db) => {
      db.credentials = db.credentials.filter((c) => c.id !== id)
      normalizeSameApiKeyState(db.credentials)
      const gone = db.proxies.filter((p) => p.credentialId === id)
      db.proxies = db.proxies.filter((p) => p.credentialId !== id)
      removedProxies = gone.length > 0
      // the daily ledgers survive as tombstones — app totals must not change on entity deletion;
      // the keys die with the credential, so their leaves tombstone too
      const node = getCredentialNode(db.usageHistory, id)
      if (node) {
        node.deleted = true
        for (const pid of Object.keys(node.proxies)) node.proxies[pid].deleted = true
      }
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
      normalizeSameApiKeyState(db.credentials)
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
