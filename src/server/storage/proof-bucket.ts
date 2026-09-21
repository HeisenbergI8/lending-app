/**
 * The proof-of-payment bucket.
 *
 * Supabase Storage over plain fetch rather than @supabase/supabase-js. The whole
 * surface this app needs is three calls — put a file, sign a link, remove a file
 * — and a serverless function has a size budget worth spending on something
 * else. Nothing here is clever; it is the REST API the client library wraps.
 *
 * THE BUCKET IS PRIVATE. Files are reachable only through short-lived signed
 * links minted per page render. A public bucket would put a borrower's payment
 * screenshot behind a guessable URL, and the whole reason real names stay off
 * the demo account is that this is other people's financial life.
 *
 * The service-role key bypasses every permission rule in the project, so it is
 * read here and nowhere else, and never reaches a client component.
 */

type BucketConfig = { url: string; key: string; bucket: string }

/**
 * Read on first use, not on import.
 *
 * Same reason as src/server/db.ts: a module-scope read would demand these
 * variables from anything that imported the file, including Next's build
 * collecting page data in an environment that has no Supabase credentials.
 */
function config(): BucketConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET

  if (!url || !key || !bucket) {
    throw new StorageUnavailable(
      'File storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET. See .env.example.',
    )
  }

  return { url: url.replace(/\/$/, ''), key, bucket }
}

/** Storage is not set up, or would not answer. Separated so callers can say so plainly. */
export class StorageUnavailable extends Error {}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, apikey: key }
}

/** Is the bucket configured at all? Lets a screen explain itself instead of erroring. */
export function storageConfigured(): boolean {
  try {
    config()
    return true
  } catch {
    return false
  }
}

/** Put a file in the bucket. Never overwrites: every path carries a fresh random id. */
export async function putProof(path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const { url, key, bucket } = config()

  const response = await fetch(`${url}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...headers(key), 'Content-Type': contentType, 'cache-control': 'max-age=3600' },
    body,
  })

  if (!response.ok) throw new StorageUnavailable(await describeFailure(response, 'upload'))
}

/**
 * A link to one file, good for a few minutes.
 *
 * Minted per render and deliberately short-lived: a link pasted into a chat or
 * left in a browser history stops working long before it could be useful to
 * anyone else.
 */
export async function signProof(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { url, key, bucket } = config()

  const response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...headers(key), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  })
  if (!response.ok) return null

  const signed = (await response.json()) as { signedURL?: string }
  return signed.signedURL ? `${url}/storage/v1${signed.signedURL}` : null
}

/**
 * Remove a file from the bucket.
 *
 * Where a file is really destroyed. Called as the tail of the thirty-day purge,
 * once its database row is past recovery — never when the row is merely
 * soft-deleted, because Recently Deleted restores that row and a restored row
 * pointing at a missing file would be worse than the storage it saved.
 */
export async function removeProof(path: string): Promise<void> {
  const { url, key, bucket } = config()

  const response = await fetch(`${url}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: 'DELETE',
    headers: headers(key),
  })

  // A file that is already gone is the state we wanted. Anything else is real.
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(await describeFailure(response, 'delete'))
  }
}

/** Each segment encoded on its own, so the slashes stay slashes. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Turn a storage failure into a sentence someone can act on.
 *
 * Supabase answers with its own JSON, and pasting that into the screen tells the
 * admin nothing they can use. The two failures that actually happen in practice
 * — a key that was never filled in, and a bucket that does not exist yet — each
 * get told what to go and do about it.
 *
 * Only the reason is ever shown. The key is never part of a response body, and
 * nothing here puts it in one.
 */
async function describeFailure(response: Response, what: 'upload' | 'delete'): Promise<string> {
  let reason = ''
  try {
    const body = (await response.text()).slice(0, 400)
    const parsed = JSON.parse(body) as { message?: string; error?: string }
    reason = parsed.message ?? parsed.error ?? body
  } catch {
    reason = ''
  }

  const lowered = reason.toLowerCase()

  if (response.status === 401 || response.status === 403 || lowered.includes('jws') || lowered.includes('unauthorized')) {
    return 'file storage rejected the key. Check SUPABASE_SERVICE_ROLE_KEY in .env. It is the service_role key from Supabase → Project Settings → API.'
  }
  if (response.status === 404 || lowered.includes('bucket not found')) {
    return `the storage bucket "${process.env.SUPABASE_STORAGE_BUCKET}" does not exist. Create it in Supabase → Storage, and keep it private.`
  }
  if (response.status === 413) {
    return 'the file was too large for storage.'
  }

  return `the ${what} failed (${response.status})${reason ? `: ${reason}` : ''}.`
}
