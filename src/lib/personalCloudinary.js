export async function testCloudinaryOAuthConnection({ cloudName, oauthToken }) {
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/image?max_results=1`,
    { headers: { Authorization: `Bearer ${oauthToken}`, Accept: 'application/json' } },
  )
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Cloudinary rejected the connection (${response.status}): ${detail.slice(0, 180)}`)
  }
}

export async function uploadToPersonalCloudinary(file, { cloudName, oauthToken, folder, publicId }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folder)
  formData.append('public_id', publicId)
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${oauthToken}` },
      body: formData,
    },
  )
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.secure_url) {
    throw new Error(data?.error?.message || `Cloudinary upload failed (${response.status})`)
  }
  return data
}

export async function deleteFromPersonalCloudinary(publicId, { cloudName, oauthToken }) {
  const formData = new FormData()
  formData.append('public_id', publicId)
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${oauthToken}` },
      body: formData,
    },
  )
  if (!response.ok) throw new Error(`Cloudinary delete failed (${response.status})`)
  return response.json()
}
