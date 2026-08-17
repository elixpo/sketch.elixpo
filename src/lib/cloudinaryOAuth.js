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

function cloudNameFromResource(value) {
  if (typeof value !== 'string') return ''
  const cloudinaryUrl = value.match(/^cloudinary:\/\/[^@]+@([^/?#]+)/i)
  if (cloudinaryUrl?.[1]) return cloudinaryUrl[1]
  const apiUrl = value.match(/\/v1_1\/([^/?#]+)/i)
  if (apiUrl?.[1]) return apiUrl[1]
  const deliveryUrl = value.match(/res\.cloudinary\.com\/([^/?#]+)/i)
  if (deliveryUrl?.[1]) return deliveryUrl[1]
  return isValidCloudinaryCloudName(value) ? value : ''
}

function parseEmbeddedObject(value) {
  if (typeof value !== 'string' || !/^[{[]/.test(value.trim())) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function extractCloudinaryCloudName(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return ''
  seen.add(value)

  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const isCloudNameKey = normalizedKey === 'cloudname'
      || normalizedKey.endsWith('cloudname')
      || normalizedKey === 'productenvironment'
      || normalizedKey === 'productenvironmentname'
      || normalizedKey === 'cloud'
    if (isCloudNameKey && typeof rawValue === 'string' && isValidCloudinaryCloudName(rawValue)) {
      return rawValue
    }
    if (['resource', 'resourceuri', 'apiurl', 'uploadurl'].includes(normalizedKey)) {
      const fromResource = cloudNameFromResource(rawValue)
      if (fromResource) return fromResource
    }

    const nestedValue = parseEmbeddedObject(rawValue) || rawValue
    const nested = extractCloudinaryCloudName(nestedValue, depth + 1, seen)
    if (nested) return nested
  }
  return ''
}

export async function resolveCloudinaryCloudName(tokens, callbackUrl) {
  const callbackIdentity = Object.fromEntries(callbackUrl.searchParams.entries())
  const direct = extractCloudinaryCloudName(tokens)
    || extractCloudinaryCloudName(callbackIdentity)
    || extractCloudinaryCloudName(decodeJwtPayload(tokens.access_token))
    || extractCloudinaryCloudName(decodeJwtPayload(tokens.id_token))
  if (direct) return direct
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  })
  if (!response.ok) return ''
  const body = await response.text()
  let userInfo
  try {
    userInfo = JSON.parse(body)
  } catch {
    userInfo = decodeJwtPayload(body)
  }
  return extractCloudinaryCloudName(userInfo)
}

export function describeCloudinaryOAuthShape(tokens, callbackUrl) {
  return {
    tokenFields: Object.keys(tokens || {}).sort(),
    callbackFields: [...callbackUrl.searchParams.keys()].sort(),
    accessTokenClaimFields: Object.keys(decodeJwtPayload(tokens?.access_token) || {}).sort(),
    idTokenClaimFields: Object.keys(decodeJwtPayload(tokens?.id_token) || {}).sort(),
  }
}

export function isValidCloudinaryCloudName(value) {
  return typeof value === 'string' && value.length <= 255 && /^[a-z0-9][a-z0-9_-]*$/i.test(value)
}

export function tokenExpiry(expiresIn, now = Math.floor(Date.now() / 1000)) {
  const seconds = Number(expiresIn)
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 300)
}
