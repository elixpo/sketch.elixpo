'use client'

import { useEffect, useMemo, useState } from 'react'
import useAuthStore from '@/store/useAuthStore'
import { showToast } from '@/utils/toast'

function authenticatedHeaders(sessionToken, headers = {}) {
  return sessionToken ? { ...headers, Authorization: `Bearer ${sessionToken}` } : headers
}

function configStorageKey(sessionId) {
  return `lixsketch-mcp-configs-${sessionId}`
}

function readSavedConfigs(sessionId) {
  if (typeof window === 'undefined' || !sessionId) return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(configStorageKey(sessionId)) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSavedConfigs(sessionId, configs) {
  if (!sessionId) return
  try {
    if (Object.keys(configs).length) localStorage.setItem(configStorageKey(sessionId), JSON.stringify(configs))
    else localStorage.removeItem(configStorageKey(sessionId))
  } catch {}
}

function RevokeAccessDialog({ grant, busy, onCancel, onConfirm }) {
  if (!grant) return null
  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="revoke-mcp-title" className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#171120] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300"><i className="bx bx-unlink text-xl" /></span>
          <div><h3 id="revoke-mcp-title" className="text-base text-text-primary">Revoke MCP access?</h3><p className="mt-1 text-xs leading-5 text-text-muted"><strong className="font-normal text-text-secondary">{grant.label}</strong> will immediately lose access to this workspace.</p></div>
        </div>
        <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-[11px] leading-5 text-red-300">Any saved configuration using this token will stop working. Canvas content and media will not be deleted.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-xs text-text-secondary hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50">{busy && <i className="bx bx-loader-alt animate-spin" />}Revoke access</button>
        </div>
      </div>
    </div>
  )
}

export default function McpWorkspaceAccessModal({ workspace, onClose }) {
  const [grants, setGrants] = useState([])
  const [savedConfigs, setSavedConfigs] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [visibleGrantId, setVisibleGrantId] = useState(null)
  const [copiedGrantId, setCopiedGrantId] = useState(null)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [label, setLabel] = useState('Local MCP')
  const [writeAccess, setWriteAccess] = useState(true)
  const [expiresInDays, setExpiresInDays] = useState(30)
  const sessionToken = useAuthStore((state) => state.sessionToken)
  const sessionId = workspace?.session_id
  const encryptionKey = useMemo(() => {
    if (typeof window === 'undefined' || !sessionId) return ''
    return localStorage.getItem(`lixsketch-enc-key-${sessionId}`) || ''
  }, [sessionId])

  useEffect(() => {
    setSavedConfigs(readSavedConfigs(sessionId))
    setVisibleGrantId(null)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/mcp/grants?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: authenticatedHeaders(sessionToken),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'Could not load agent access')
        const activeGrants = body.grants || []
        setGrants(activeGrants)
        setSavedConfigs((current) => {
          const activeIds = new Set(activeGrants.map((grant) => grant.id))
          const next = Object.fromEntries(Object.entries(current).filter(([grantId]) => activeIds.has(grantId)))
          writeSavedConfigs(sessionId, next)
          return next
        })
      })
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [sessionId, sessionToken])

  useEffect(() => {
    const close = (event) => {
      if (event.key !== 'Escape' || busy) return
      if (revokeTarget) setRevokeTarget(null)
      else onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose, revokeTarget])

  const createGrant = async () => {
    const normalizedLabel = label.trim()
    if (!normalizedLabel) {
      setError('Give this client a name before creating access.')
      return
    }
    if (!encryptionKey) {
      setError('Open this workspace on this device once before enabling remote access. Its E2E key is not available here.')
      return
    }
    setBusy(true)
    setError('')
    setCopiedGrantId(null)
    try {
      const scopes = ['canvas:read', ...(writeAccess ? ['canvas:write'] : [])]
      const response = await fetch('/api/mcp/grants', {
        method: 'POST',
        headers: authenticatedHeaders(sessionToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId, label: normalizedLabel, scopes, expiresInDays }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not create agent access')
      const config = JSON.stringify({
        mcpServers: {
          lixsketch: {
            command: 'npx',
            args: ['-y', '@elixpo/lixsketch', '--remote', window.location.origin, '--workspace', sessionId],
            env: { LIXSKETCH_AGENT_TOKEN: body.token, LIXSKETCH_ENCRYPTION_KEY: encryptionKey },
          },
        },
      }, null, 2)
      const nextConfigs = { ...savedConfigs, [body.grant.id]: { config, savedAt: new Date().toISOString() } }
      writeSavedConfigs(sessionId, nextConfigs)
      setSavedConfigs(nextConfigs)
      setVisibleGrantId(body.grant.id)
      setGrants((current) => [body.grant, ...current])
      showToast('Remote MCP access created', { tone: 'success', duration: 2200 })
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!revokeTarget) return
    const grantId = revokeTarget.id
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/mcp/grants', {
        method: 'DELETE',
        headers: authenticatedHeaders(sessionToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ grantId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not revoke access')
      const nextConfigs = { ...savedConfigs }
      delete nextConfigs[grantId]
      writeSavedConfigs(sessionId, nextConfigs)
      setSavedConfigs(nextConfigs)
      setGrants((current) => current.filter((grant) => grant.id !== grantId))
      if (visibleGrantId === grantId) setVisibleGrantId(null)
      setRevokeTarget(null)
      showToast('Remote MCP access revoked', { tone: 'success', duration: 2200 })
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (grantId) => {
    const config = savedConfigs[grantId]?.config
    if (!config) return
    try {
      await navigator.clipboard.writeText(config)
      setCopiedGrantId(grantId)
      showToast('MCP configuration copied', { tone: 'success', duration: 2000 })
      setTimeout(() => setCopiedGrantId((current) => current === grantId ? null : current), 2200)
    } catch {
      setError('Could not copy the configuration. Select the text and copy it manually.')
    }
  }

  if (!workspace) return null
  const visibleConfig = visibleGrantId ? savedConfigs[visibleGrantId]?.config : null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="mcp-access-title" className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#8B88E8]/30 bg-[#171120] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-[#A99CF1]">Workspace access</p><h2 id="mcp-access-title" className="mt-1 text-xl text-text-primary">Remote MCP</h2><p className="mt-1 text-xs text-text-dim">{workspace.workspace_name || 'Untitled'} · {sessionId}</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="cursor-pointer rounded-lg p-2 text-text-dim hover:bg-white/5 hover:text-text-primary"><i className="bx bx-x text-xl" /></button>
        </div>

        <div className="mt-5 rounded-xl border border-[#8B88E8]/20 bg-[#8B88E8]/5 p-4 text-xs leading-5 text-text-muted">Each token is limited to this workspace. Recoverable configurations are stored only in this browser; the server stores a token hash and never receives the E2E key.</div>
        {!encryptionKey && <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-300">This browser does not have the workspace encryption key. Open the canvas once, then return here.</div>}
        {error && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-xs text-red-300">{error}</div>}

        <section className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div><p className="text-sm text-text-primary">New client access</p><p className="mt-1 text-[10px] text-text-dim">Name the client, choose its scopes, and set an expiry.</p></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-[10px] text-text-dim">Client name <span className="text-red-300">*</span><input value={label} maxLength={48} onChange={(event) => setLabel(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-text-primary outline-none focus:border-[#8B88E8]/60" placeholder="Desktop agent" /></label>
            <label className="text-[10px] text-text-dim">Expires <span className="text-red-300">*</span><select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="mt-1 block w-full cursor-pointer rounded-lg border border-white/10 bg-[#171120] px-3 py-2 text-xs text-text-primary outline-none focus:border-[#8B88E8]/60"><option value={7}>7 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-not-allowed items-start gap-2 rounded-lg border border-[#8B88E8]/20 bg-[#8B88E8]/5 p-2.5"><input type="checkbox" checked disabled className="mt-0.5 accent-[#8B88E8]" /><span><span className="block text-xs text-text-secondary">Read canvas</span><span className="text-[9px] text-text-dim">Required to inspect revisions and shapes</span></span></label>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#8B88E8]/20 bg-[#8B88E8]/5 p-2.5"><input type="checkbox" checked={writeAccess} onChange={(event) => setWriteAccess(event.target.checked)} className="mt-0.5 accent-[#8B88E8]" /><span><span className="block text-xs text-text-secondary">Edit canvas</span><span className="text-[9px] text-text-dim">Apply patches and LixScript</span></span></label>
          </div>
          <div className="mt-3 flex justify-end"><button type="button" onClick={createGrant} disabled={busy || !encryptionKey || !label.trim()} className="cursor-pointer rounded-lg bg-[#8B88E8] px-3 py-2 text-xs text-white hover:bg-[#9E91EE] disabled:cursor-not-allowed disabled:opacity-40"><i className="bx bx-plus mr-1" />Create access</button></div>
        </section>

        {visibleConfig && <div className="mt-4 rounded-xl border border-green-500/25 bg-green-500/5 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm text-green-300">Configuration ready</p><p className="mt-1 text-[10px] text-text-dim">Available again on this browser while the grant remains active.</p></div><button type="button" onClick={() => copy(visibleGrantId)} className="cursor-pointer rounded-lg bg-[#8B88E8] px-3 py-2 text-xs text-white hover:bg-[#9E91EE]"><i className={`bx ${copiedGrantId === visibleGrantId ? 'bx-check' : 'bx-copy'} mr-1`} />{copiedGrantId === visibleGrantId ? 'Copied' : 'Copy config'}</button></div>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-black/30 p-3 text-[10px] leading-5 text-[#d8c9f5]"><code>{visibleConfig}</code></pre>
        </div>}

        <div className="mt-5 border-b border-white/[0.07] pb-3"><p className="text-sm text-text-primary">Authorized clients</p><p className="text-[10px] text-text-dim">Only currently active grants are shown.</p></div>
        <div className="mt-3 space-y-2">
          {loading ? <p className="py-5 text-center text-xs text-text-dim">Loading access…</p> : grants.length === 0 ? <p className="py-5 text-center text-xs text-text-dim">No clients are authorized for this workspace.</p> : grants.map((grant) => {
            const hasConfig = Boolean(savedConfigs[grant.id]?.config)
            return <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs text-text-secondary">{grant.label}</p><p className="mt-1 text-[9px] text-text-dim">{grant.scopes?.join(' + ') || grant.permission} · expires {new Date(grant.expiresAt).toLocaleDateString()} {grant.lastUsedAt ? `· used ${new Date(grant.lastUsedAt).toLocaleDateString()}` : ''}</p></div><div className="flex items-center gap-1.5">{hasConfig ? <button type="button" onClick={() => setVisibleGrantId((current) => current === grant.id ? null : grant.id)} className="cursor-pointer rounded-lg border border-[#8B88E8]/30 px-2.5 py-1.5 text-[10px] text-[#B6ACF4] hover:bg-[#8B88E8]/10"><i className="bx bx-code-alt mr-1" />{visibleGrantId === grant.id ? 'Hide config' : 'Show config'}</button> : <span className="px-1 text-[9px] text-text-dim" title="This grant was created before configs were saved on this browser">Config not saved</span>}<button type="button" onClick={() => setRevokeTarget(grant)} disabled={busy} className="cursor-pointer rounded-lg border border-red-500/25 px-2.5 py-1.5 text-[10px] text-red-300 hover:bg-red-500/10">Revoke</button></div></div>
          })}
        </div>
      </div>
      <RevokeAccessDialog grant={revokeTarget} busy={busy} onCancel={() => setRevokeTarget(null)} onConfirm={revoke} />
    </div>
  )
}
