import assert from 'node:assert/strict'
import test from 'node:test'

import { getAuthenticatedUser } from '../src/lib/serverAuth.js'

function requestWith({ bearer, cookie } = {}) {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === 'authorization' && bearer ? `Bearer ${bearer}` : null
      },
    },
    cookies: {
      get(name) {
        if (name !== 'lixsketch-session' || !cookie) return undefined
        return { value: encodeURIComponent(JSON.stringify(cookie)) }
      },
    },
  }
}

test('server auth accepts the current bearer token and falls back to its cookie', async () => {
  const originalFetch = globalThis.fetch
  const tokens = []
  globalThis.fetch = async (_url, options) => {
    tokens.push(options.headers.Authorization)
    return {
      ok: true,
      async json() {
        return { id: 'user-1', email: 'owner@example.com', displayName: 'Owner' }
      },
    }
  }

  try {
    const bearerUser = await getAuthenticatedUser(requestWith({
      bearer: 'current-token',
      cookie: { sessionToken: 'stale-token', user: { email: 'stale@example.com' } },
    }))
    const cookieUser = await getAuthenticatedUser(requestWith({
      cookie: { sessionToken: 'cookie-token', user: { email: 'owner@example.com' } },
    }))

    assert.equal(bearerUser.id, 'user-1')
    assert.equal(cookieUser.id, 'user-1')
    assert.deepEqual(tokens, ['Bearer current-token', 'Bearer cookie-token'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
