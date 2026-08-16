'use client'

import { useEffect, useMemo, useState } from 'react'

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`
}

const RESULT_MESSAGES = {
  connected: { ok: true, text: 'Cloudinary connected. New media will use your product environment.' },
  disconnected: { ok: true, text: 'Cloudinary disconnected. Existing media remains in your Cloudinary account.' },
  denied: { ok: false, text: 'Cloudinary authorization was cancelled.' },
  invalid_state: { ok: false, text: 'The authorization session expired. Please try again.' },
  config_error: { ok: false, text: 'Cloudinary OAuth is not configured on this deployment.' },
}

export default function CloudinaryIntegrationCard() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [oauthResult, setOauthResult] = useState(null)
  const [oauthReference, setOauthReference] = useState(null)

  const oauthMessage = useMemo(() => {
    if (!oauthResult) return null
    if (RESULT_MESSAGES[oauthResult]) return RESULT_MESSAGES[oauthResult]
    return { ok: false, text: 'Cloudinary could not be connected.' }
  }, [oauthResult])

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/integrations/cloudinary', { cache: 'no-store' })
      if (!response.ok) throw new Error('Could not load Cloudinary status')
      const data = await response.json()
      setStatus(data)
      window.__personalCloudinary = data
    } catch (cause) {
      setError(cause.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setOauthResult(params.get('cloudinary'))
    setOauthReference(params.get('cloudinary_ref'))
    load()
  }, [])

  const toggleStorage = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/cloudinary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useForUploads: !status.useForUploads }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not update storage preference')
      setStatus(data)
      window.__personalCloudinary = data
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/cloudinary', { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not disconnect Cloudinary')
      window.__personalCloudinary = { connected: false, useForUploads: false }
      window.location.href = data.postLogoutRedirect || '/settings?tab=integrations'
    } catch (cause) {
      setError(cause.message)
      setBusy(false)
      setConfirmDisconnect(false)
    }
  }

  return (
    <section id="integrations" className="rounded-2xl border border-[#8B88E8]/25 bg-[#8B88E8]/[0.045] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8B88E8]/15 text-[#A99CF1]">
            <i className="bx bx-cloud text-2xl" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-text-primary">Personal Cloudinary storage</h2>
              {status && (
                <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${status.connected ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-text-dim'}`}>
                  {status.connected ? 'Connected' : 'Not connected'}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-text-dim">
              Store new canvas and document images in your own Cloudinary product environment. Personal storage does not consume LixSketch’s per-workspace image allowance.
            </p>
          </div>
        </div>
      </div>

      {oauthMessage && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${oauthMessage.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {oauthMessage.text}{oauthReference && !oauthMessage.ok ? ` Reference: ${oauthReference}` : ''}
        </p>
      )}

      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-xl bg-white/[0.035]" />
      ) : !status?.connected ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-white/[0.07] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-text-secondary">Authorize upload and asset management access</p>
            <p className="mt-1 text-[10px] text-text-dim">Uses OpenID and offline access so the server can refresh encrypted tokens. Your API secret is never requested.</p>
          </div>
          <a href="/api/integrations/cloudinary/connect" className="cursor-pointer rounded-lg bg-[#8B88E8] px-4 py-2 text-center text-xs text-white transition-colors hover:bg-[#9E91EE]">
            Connect Cloudinary
          </a>
        </div>
      ) : (
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-dim">Product environment</p>
              <p className="mt-1 text-sm text-text-primary">{status.cloudName}</p>
              <p className="mt-1 text-[10px] text-text-dim">{formatBytes(status.trackedBytes)} across {status.mediaCount} tracked {status.mediaCount === 1 ? 'asset' : 'assets'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={toggleStorage} className="cursor-pointer rounded-lg border border-[#8B88E8]/30 px-3 py-2 text-xs text-[#A99CF1] hover:bg-[#8B88E8]/10 disabled:opacity-50">
                {status.useForUploads ? 'Use LixSketch storage' : 'Use personal storage'}
              </button>
              <button type="button" disabled={busy} onClick={disconnect} onMouseLeave={() => setConfirmDisconnect(false)} className="cursor-pointer rounded-lg border border-red-500/25 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                {confirmDisconnect ? 'Disconnect and keep existing media' : 'Disconnect'}
              </button>
            </div>
          </div>
          <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${status.useForUploads ? 'bg-green-500/10 text-green-400' : 'bg-white/[0.035] text-text-dim'}`}>
            New media will use {status.useForUploads ? status.cloudName : 'LixSketch managed storage'}. Existing images stay where they were uploaded.
          </p>
        </div>
      )}
      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
    </section>
  )
}
