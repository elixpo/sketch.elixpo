import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/serverAuth'
import { buildCloudinaryAuthorizationUrl, isValidCloudinaryCloudName } from '@/lib/cloudinaryOAuth'

export const runtime = 'edge'

export async function GET(request) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.redirect(new URL('/?signin=required', request.url))
  try {
    const state = crypto.randomUUID()
    const requestUrl = new URL(request.url)
    const requestedCloudName = requestUrl.searchParams.get('cloud_name')?.trim() || ''
    if (!isValidCloudinaryCloudName(requestedCloudName)) {
      return NextResponse.redirect(new URL('/settings?tab=integrations&cloudinary=invalid_environment', request.url))
    }
    const response = NextResponse.redirect(buildCloudinaryAuthorizationUrl({
      origin: requestUrl.origin,
      state,
    }))
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    }
    response.cookies.set('cloudinary_oauth_state', state, options)
    response.cookies.set('cloudinary_oauth_cloud_name', requestedCloudName, options)
    return response
  } catch (error) {
    console.error('[cloudinary/oauth] Could not start authorization:', error?.message || error)
    return NextResponse.redirect(new URL('/settings?tab=integrations&cloudinary=config_error', request.url))
  }
}
