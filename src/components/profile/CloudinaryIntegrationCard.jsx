'use client'

import { useEffect, useMemo, useState } from 'react'

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`
}

function PersonalStorageMeter({ usage }) {
  if (!usage) return null
  const percentage = Math.max(0, Math.min(100, Number(usage.usedPercent) || 0))
  return (
    <div className="mt-4 rounded-xl border border-[#8B88E8]/20 bg-black/10 p-3">
      <div className="flex items-center justify-between gap-3 text-[10px]">
        <span className="uppercase tracking-wider text-text-dim">Cloudinary storage</span>
        <span className="font-mono text-text-secondary">{formatBytes(usage.remainingBytes)} remaining</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-[#9E91EE] transition-all duration-500" style={{ width: `${percentage}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-text-dim">
        <span>{formatBytes(usage.usedBytes)} used of {formatBytes(usage.limitBytes)}</span>
        {usage.plan && <span>{usage.plan}</span>}
      </div>
    </div>
  )
}

const RESULT_MESSAGES = {
  connected: { ok: true, text: 'Cloudinary connected. New media will use your product environment.' },
  disconnected: { ok: true, text: 'Cloudinary disconnected. Existing media remains in your Cloudinary account.' },
  denied: { ok: false, text: 'Cloudinary authorization was cancelled.' },
  invalid_state: { ok: false, text: 'The authorization session expired. Please try again.' },
  invalid_environment: { ok: false, text: 'Enter a valid Cloudinary cloud name before connecting.' },
  failed_environment: { ok: false, text: 'Cloudinary did not return a product environment. Confirm the cloud name and try again.' },
  failed_validation: { ok: false, text: 'Cloudinary did not authorize access to that product environment. Confirm the cloud name and account selection.' },
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
  const [cloudNameInput, setCloudNameInput] = useState('')

  const oauthMessage = useMemo(() => {
    if (!oauthResult) return null
    if (RESULT_MESSAGES[oauthResult]) return RESULT_MESSAGES[oauthResult]
    return { ok: false, text: 'Cloudinary could not be connected.' }
  }, [oauthResult])

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/integrations/cloudinary?includeUsage=1', { cache: 'no-store' })
      if (!response.ok) throw new Error('Could not load Cloudinary status')
      const data = await response.json()
      setStatus((current) => ({ ...current, ...data }))
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
      setStatus((current) => ({ ...current, ...data }))
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

  const connect = (event) => {
    event.preventDefault()
    const cloudName = cloudNameInput.trim()
    if (!/^[a-z0-9][a-z0-9_-]{1,254}$/i.test(cloudName)) {
      setError('Enter the cloud name shown on your Cloudinary dashboard.')
      return
    }
    setError('')
    window.location.href = `/api/integrations/cloudinary/connect?cloud_name=${encodeURIComponent(cloudName)}`
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
        <form onSubmit={connect} className="mt-4 flex flex-col gap-3 border-t border-white/[0.07] pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs text-text-secondary">Authorize upload and asset management access</p>
            <p className="mt-1 text-[10px] text-text-dim">Uses OpenID and offline access so the server can refresh encrypted tokens. Your API secret is never requested.</p>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-text-dim" htmlFor="cloudinary-cloud-name">Cloud name</label>
            <input
              id="cloudinary-cloud-name"
              value={cloudNameInput}
              onChange={(event) => setCloudNameInput(event.target.value)}
              placeholder="Shown on your Cloudinary dashboard"
              autoComplete="off"
              spellCheck="false"
              className="mt-1 w-full min-w-0 rounded-lg border border-[#8B88E8]/25 bg-black/15 px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-[#8B88E8]/60 sm:w-72"
            />
            <p className="mt-1 text-[9px] text-text-dim">The cloud name is a public product-environment identifier.</p>
          </div>
          <button type="submit" className="cursor-pointer rounded-lg bg-[#8B88E8] px-4 py-2 text-center text-xs text-white transition-colors hover:bg-[#9E91EE]">
            Connect Cloudinary
          </button>
        </form>
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
          <PersonalStorageMeter usage={status.providerUsage} />
          {status.providerUsageUnavailable && (
            <p className="mt-3 text-[10px] text-amber-300/80">
              Cloudinary did not expose the product-environment allowance. LixSketch has tracked {formatBytes(status.trackedBytes)} of uploaded media.
            </p>
          )}
          <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${status.useForUploads ? 'bg-green-500/10 text-green-400' : 'bg-white/[0.035] text-text-dim'}`}>
            New media will use {status.useForUploads ? status.cloudName : 'LixSketch managed storage'}. Existing images stay where they were uploaded.
          </p>
        </div>
      )}
      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
    </section>
  )
}
