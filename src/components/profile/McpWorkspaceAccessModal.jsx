'use client'

import { useEffect, useMemo, useState } from 'react'

export default function McpWorkspaceAccessModal({ workspace, onClose }) {
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState(null)
  const [confirmGrantId, setConfirmGrantId] = useState(null)
  const sessionId = workspace?.session_id
  const encryptionKey = useMemo(() => {
    if (typeof window === 'undefined' || !sessionId) return ''
    return localStorage.getItem(`lixsketch-enc-key-${sessionId}`) || ''
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/mcp/grants?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'Could not load agent access')
        setGrants(body.grants || [])
      })
      .catch((failure) => setError(failure.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])

  const createGrant = async () => {
    if (!encryptionKey) {
      setError('Open this workspace on this device once before enabling remote access. Its E2E key is not available here.')
      return
    }
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/mcp/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, label: 'Local MCP', permission: 'edit', expiresInDays: 30 }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not create agent access')
      const origin = window.location.origin
      const config = {
        mcpServers: {
          lixsketch: {
            command: 'npx',
            args: ['-y', '@elixpo/lixsketch', '--remote', origin, '--workspace', sessionId],
            env: { LIXSKETCH_AGENT_TOKEN: body.token, LIXSKETCH_ENCRYPTION_KEY: encryptionKey },
          },
        },
      }
      setIssued({ ...body.grant, token: body.token, config: JSON.stringify(config, null, 2) })
      setGrants((current) => [body.grant, ...current])
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  const revoke = async (grantId) => {
    if (confirmGrantId !== grantId) {
      setConfirmGrantId(grantId)
      return
    }
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/mcp/grants', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grantId }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not revoke access')
      setGrants((current) => current.map((grant) => grant.id === grantId ? { ...grant, revokedAt: new Date().toISOString() } : grant))
      if (issued?.id === grantId) setIssued(null)
      setConfirmGrantId(null)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  const copy = async () => {
    if (!issued?.config) return
    await navigator.clipboard.writeText(issued.config)
  }

  if (!workspace) return null
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="mcp-access-title" className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#8B88E8]/30 bg-[#171120] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-[#A99CF1]">Workspace access</p><h2 id="mcp-access-title" className="mt-1 text-xl text-text-primary">Remote MCP</h2><p className="mt-1 text-xs text-text-dim">{workspace.workspace_name || 'Untitled'} · {sessionId}</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="cursor-pointer rounded-lg p-2 text-text-dim hover:bg-white/5 hover:text-text-primary"><i className="bx bx-x text-xl" /></button>
        </div>

        <div className="mt-5 rounded-xl border border-[#8B88E8]/20 bg-[#8B88E8]/5 p-4 text-xs leading-5 text-text-muted">
          The token authorizes this workspace only. The E2E key is copied directly from this browser into your local client configuration and is never sent to LixSketch as part of the grant.
        </div>
        {!encryptionKey && <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-300">This browser does not have the workspace encryption key. Open the canvas once, then return here.</div>}
        {error && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-xs text-red-300">{error}</div>}

        {issued && <div className="mt-5 rounded-xl border border-green-500/25 bg-green-500/5 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm text-green-300">Configuration ready</p><p className="mt-1 text-[10px] text-text-dim">The token is shown once. Copy and store it now.</p></div><button type="button" onClick={copy} className="cursor-pointer rounded-lg bg-[#8B88E8] px-3 py-2 text-xs text-white hover:bg-[#9E91EE]"><i className="bx bx-copy mr-1" />Copy config</button></div>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-black/30 p-3 text-[10px] leading-5 text-[#d8c9f5]"><code>{issued.config}</code></pre>
        </div>}

        <div className="mt-5 flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3"><div><p className="text-sm text-text-primary">Authorized clients</p><p className="text-[10px] text-text-dim">Edit access · expires after 30 days</p></div><button type="button" onClick={createGrant} disabled={busy || !encryptionKey} className="cursor-pointer rounded-lg bg-[#8B88E8] px-3 py-2 text-xs text-white hover:bg-[#9E91EE] disabled:cursor-not-allowed disabled:opacity-40"><i className="bx bx-plus mr-1" />Create access</button></div>
        <div className="mt-3 space-y-2">
          {loading ? <p className="py-5 text-center text-xs text-text-dim">Loading access…</p> : grants.length === 0 ? <p className="py-5 text-center text-xs text-text-dim">No clients are authorized for this workspace.</p> : grants.map((grant) => {
            const inactive = Boolean(grant.revokedAt) || new Date(grant.expiresAt).getTime() <= Date.now()
            return <div key={grant.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="min-w-0"><p className="truncate text-xs text-text-secondary">{grant.label}</p><p className="mt-1 text-[9px] text-text-dim">{inactive ? 'Inactive' : `${grant.permission} · expires ${new Date(grant.expiresAt).toLocaleDateString()}`} {grant.lastUsedAt ? `· used ${new Date(grant.lastUsedAt).toLocaleDateString()}` : ''}</p></div>{!inactive && <button type="button" onClick={() => revoke(grant.id)} disabled={busy} className="cursor-pointer rounded-lg border border-red-500/25 px-2.5 py-1.5 text-[10px] text-red-300 hover:bg-red-500/10">{confirmGrantId === grant.id ? 'Confirm revoke' : 'Revoke'}</button>}</div>
          })}
        </div>
      </div>
    </div>
  )
}
