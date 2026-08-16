const AUTHORIZE_URL = 'https://oauth.cloudinary.com/oauth2/auth'
const TOKEN_URL = 'https://oauth.cloudinary.com/oauth2/token'
const REVOKE_URL = 'https://oauth.cloudinary.com/oauth2/revoke'
const USERINFO_URL = 'https://oauth.cloudinary.com/userinfo'

export const CLOUDINARY_OAUTH_SCOPE = 'openid offline_access asset_management upload'

function oauthConfig() {
  const clientId = process.env.CLOUDINARY_OAUTH_CLIENT_ID
  const clientSecret = process.env.CLOUDINARY_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret || /^ENC\[/.test(clientId) || /^ENC\[/.test(clientSecret)) {
    throw new Error('Cloudinary OAuth client credentials are not configured')
  }
  return { clientId, clientSecret }
}

function basicCredentials() {
  const { clientId, clientSecret } = oauthConfig()
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

export function cloudinaryOAuthRedirectUri(origin) {
  return `${origin}/api/integrations/cloudinary/callback`
}

export function buildCloudinaryAuthorizationUrl({ origin, state }) {
  const { clientId } = oauthConfig()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: cloudinaryOAuthRedirectUri(origin),
    scope: CLOUDINARY_OAUTH_SCOPE,
    state,
  })
  return `${AUTHORIZE_URL}?${params}`
}

async function requestTokens(params) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicCredentials(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Cloudinary OAuth failed (${response.status})`)
  }
  return data
}

export function exchangeCloudinaryCode({ code, origin }) {
  return requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cloudinaryOAuthRedirectUri(origin),
  })
}

export function refreshCloudinaryTokens(refreshToken) {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function revokeCloudinaryToken(token) {
  if (!token) return
  const response = await fetch(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization: basicCredentials(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ token }),
  })
  if (!response.ok) throw new Error(`Cloudinary token revocation failed (${response.status})`)
}

function decodeJwtPayload(token) {
  const payload = String(token || '').split('.')[1]
  if (!payload) return null
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function cloudNameFrom(value) {
  return value?.cloud_name || value?.cloudName || value?.ext?.cloud_name
    || value?.product_environment?.cloud_name || value?.productEnvironment?.cloudName || ''
}

export async function resolveCloudinaryCloudName(tokens, callbackUrl) {
  const direct = cloudNameFrom(tokens)
    || callbackUrl.searchParams.get('cloud_name')
    || callbackUrl.searchParams.get('cloudName')
    || cloudNameFrom(decodeJwtPayload(tokens.access_token))
    || cloudNameFrom(decodeJwtPayload(tokens.id_token))
  if (direct) return direct
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  })
  return response.ok ? cloudNameFrom(await response.json()) : ''
}

export function isValidCloudinaryCloudName(value) {
  return typeof value === 'string' && value.length <= 255 && /^[a-z0-9][a-z0-9_-]*$/i.test(value)
}

export function tokenExpiry(expiresIn, now = Math.floor(Date.now() / 1000)) {
  const seconds = Number(expiresIn)
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 300)
}
