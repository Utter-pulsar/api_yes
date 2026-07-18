import { randomUUID } from 'node:crypto'
import { clipboard } from 'electron'
import { emptyUsage, type ProxyEndpoint } from '@shared/types'
import type { AppCore } from './context'
import type { ProxyServer } from './proxy-server'
import { getProxyLeaf } from './usage-history'
import { generateProxyKey } from './keygen'
import { mt } from './i18n'
import { normalizeSameProxyKeyState } from './store'

function sorted(core: AppCore): ProxyEndpoint[] {
  return core.store.data.proxies.slice().sort((a, b) => a.order - b.order)
}

function keyTaken(core: AppCore, key: string, exceptId?: string): boolean {
  return core.store.data.proxies.some((p) => p.key === key && p.id !== exceptId)
}

function uniqueGeneratedKey(core: AppCore, provider: 'openai' | 'anthropic'): string {
  let key = generateProxyKey(provider)
  while (keyTaken(core, key)) key = generateProxyKey(provider)
  return key
}

function sameKeyGroup(proxies: ProxyEndpoint[], key: string): ProxyEndpoint[] {
  return proxies.filter((p) => p.key.trim() === key)
}

function proxyById(core: AppCore, id: string): ProxyEndpoint {
  const proxy = core.store.data.proxies.find((p) => p.id === id)
  if (!proxy) throw new Error(mt('err.proxyNotFound'))
  return proxy
}

export function registerProxyService(core: AppCore, server: ProxyServer): void {
  // notify the renderer AND re-apply the bind (a key's exposure may have changed → the derived
  // host may need to flip; applySettings only rebinds when it actually changed).
  const changed = (): void => {
    core.broadcast('proxies.changed', sorted(core))
    void server.applySettings()
  }

  // the bind host is derived from API-key exposure + the port from settings; re-apply on settings
  // or credential (enable) changes too.
  core.events.on('settings.changed', () => void server.applySettings())
  core.events.on('credentials.changed', () => void server.applySettings())

  core.queries.register('proxies.list', ({ credentialId }) =>
    credentialId ? sorted(core).filter((p) => p.credentialId === credentialId) : sorted(core)
  )
  core.queries.register('proxy.status', () => server.getStatus())

  core.commands.register('proxies.suggestKey', ({ credentialId }) => {
    const cred = core.store.data.credentials.find((c) => c.id === credentialId)
    if (!cred) throw new Error(mt('err.authNotFound'))
    return { key: uniqueGeneratedKey(core, cred.provider) }
  })

  core.commands.register('proxies.create', ({ credentialId, name, key }) => {
    const cred = core.store.data.credentials.find((c) => c.id === credentialId)
    if (!cred) throw new Error(mt('err.authNotFound'))
    const finalKey = key?.trim() || uniqueGeneratedKey(core, cred.provider)
    const siblings = core.store.data.proxies.filter((p) => p.credentialId === credentialId)
    const order = siblings.reduce((m, p) => Math.max(m, p.order), -1) + 1
    const endpoint: ProxyEndpoint = {
      id: randomUUID(),
      credentialId,
      name: name?.trim() || `API #${siblings.length + 1}`,
      key: finalKey,
      enabled: true,
      localOnly: true,
      usage: emptyUsage(),
      createdAt: Date.now(),
      order
    }
    core.store.mutate((db) => {
      db.proxies.push(endpoint)
      normalizeSameProxyKeyState(db.proxies)
    })
    changed()
    return proxyById(core, endpoint.id)
  })

  core.commands.register('proxies.update', ({ id, patch }) => {
    let updated: ProxyEndpoint | undefined
    core.store.mutate((db) => {
      const p = db.proxies.find((x) => x.id === id)
      if (!p) return
      if (patch.name !== undefined) {
        p.name = patch.name.trim() || p.name
        // keep the history record's display name in step with the live entity
        const leaf = getProxyLeaf(db.usageHistory, p.credentialId, p.id)
        if (leaf) leaf.name = p.name
      }
      if (patch.key !== undefined && patch.key.trim()) p.key = patch.key.trim()
      if (patch.enabled !== undefined) p.enabled = patch.enabled
      if (patch.localOnly !== undefined) p.localOnly = patch.localOnly
      if (patch.limitTotalTokens !== undefined) {
        p.limitTotalTokens = patch.limitTotalTokens > 0 ? patch.limitTotalTokens : undefined
      }
      normalizeSameProxyKeyState(db.proxies)
      updated = p
    })
    if (!updated) throw new Error(mt('err.proxyNotFound'))
    changed()
    return proxyById(core, id)
  })

  core.commands.register('proxies.delete', ({ id }) => {
    core.store.mutate((db) => {
      // locate the history leaf via the entity's credentialId BEFORE the entity disappears
      const p = db.proxies.find((x) => x.id === id)
      db.proxies = db.proxies.filter((x) => x.id !== id)
      normalizeSameProxyKeyState(db.proxies)
      // the daily ledger survives as a tombstone — the credential's total must not change here
      const leaf = p ? getProxyLeaf(db.usageHistory, p.credentialId, p.id) : undefined
      if (leaf) leaf.deleted = true
    })
    changed()
  })

  core.commands.register('proxies.setSameKeyMode', ({ id, enabled }) => {
    core.store.mutate((db) => {
      const proxy = db.proxies.find((p) => p.id === id)
      if (!proxy) throw new Error(mt('err.proxyNotFound'))
      const key = proxy.key.trim()
      const group = sameKeyGroup(db.proxies, key)
      if (group.length < 2) throw new Error(mt('err.proxySameKeyNotDuplicated'))
      for (const member of group) {
        if (enabled) {
          member.sameKeyMode = true
          member.sameKeyActive = member.id === id
        } else {
          delete member.sameKeyMode
          delete member.sameKeyActive
        }
      }
      normalizeSameProxyKeyState(db.proxies)
    })
    changed()
    return proxyById(core, id)
  })

  core.commands.register('proxies.setSameKeyActive', ({ id, active }) => {
    core.store.mutate((db) => {
      const proxy = db.proxies.find((p) => p.id === id)
      if (!proxy) throw new Error(mt('err.proxyNotFound'))
      const key = proxy.key.trim()
      const group = sameKeyGroup(db.proxies, key)
      if (group.length < 2) throw new Error(mt('err.proxySameKeyNotDuplicated'))
      if (!group.some((p) => p.sameKeyMode === true)) throw new Error(mt('err.proxySameKeyModeOff'))
      for (const member of group) member.sameKeyActive = active ? member.id === id : false
      normalizeSameProxyKeyState(db.proxies)
    })
    changed()
    return proxyById(core, id)
  })

  core.commands.register('proxies.regenerateKey', ({ id }) => {
    let updated: ProxyEndpoint | undefined
    core.store.mutate((db) => {
      const p = db.proxies.find((x) => x.id === id)
      if (!p) return
      const cred = db.credentials.find((c) => c.id === p.credentialId)
      p.key = uniqueGeneratedKey(core, cred?.provider ?? 'openai')
      normalizeSameProxyKeyState(db.proxies)
      updated = p
    })
    if (!updated) throw new Error(mt('err.proxyNotFound'))
    changed()
    return proxyById(core, id)
  })

  core.commands.register('proxies.resetUsage', ({ id }) => {
    let updated: ProxyEndpoint | undefined
    core.store.mutate((db) => {
      const p = db.proxies.find((x) => x.id === id)
      if (!p) return
      p.usage = emptyUsage()
      updated = p
    })
    if (!updated) throw new Error(mt('err.proxyNotFound'))
    changed()
    return updated
  })

  core.commands.register('proxy.start', () => server.start())
  core.commands.register('proxy.stop', () => server.stop())
  core.commands.register('proxy.restart', () => server.restart())

  core.commands.register('clipboard.write', ({ text }) => {
    clipboard.writeText(text)
  })
}
