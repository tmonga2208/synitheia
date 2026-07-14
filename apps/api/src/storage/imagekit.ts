import { createHmac } from 'node:crypto';
import { AppError } from '../core/errors.js';
import { isImageKitConfigured, type Env } from '../config/env.js';

/**
 * ImageKit — where receipt images actually live.
 *
 * Mongo stores only the file id and path. Binary in the database bloats every backup and
 * drags megabytes through queries that never wanted them; a CDN is what this is for.
 *
 * Two things that are NOT the default and matter:
 *
 *  1. Files are uploaded as PRIVATE. An ImageKit URL is public by default — anyone with
 *     the link sees the image, forever, and a receipt is a picture of where someone was
 *     and what they bought. Private files cannot be fetched without a signature.
 *
 *  2. They are served through SHORT-LIVED SIGNED URLs, minted per request. The signature
 *     expires, so a URL that leaks into a log, a screenshot, or a share sheet stops
 *     working rather than being a permanent key to someone's spending.
 */

const UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const API_URL = 'https://api.imagekit.io/v1/files';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function auth(env: Env): string {
  // ImageKit takes the private key as the Basic-auth username, with an empty password.
  return `Basic ${Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString('base64')}`;
}

function requireConfig(env: Env): void {
  if (!isImageKitConfigured(env)) {
    throw AppError.aiUnavailable('Image storage is not configured on this server');
  }
}

export interface UploadedImage {
  fileId: string;
  filePath: string;
  byteSize: number;
}

export async function uploadImage(
  env: Env,
  file: { buffer: Buffer; fileName: string; contentType: string },
  folder: string,
): Promise<UploadedImage> {
  requireConfig(env);

  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.contentType }), file.fileName);
  form.append('fileName', file.fileName);
  form.append('folder', folder);
  // The whole point. A public receipt URL is a permanent, unauthenticated window into
  // someone's spending for anyone who ever sees the link.
  form.append('isPrivateFile', 'true');
  form.append('useUniqueFileName', 'true');

  let res: Response;
  try {
    res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: auth(env) },
      body: form,
    });
  } catch (err) {
    throw AppError.badRequest(
      err instanceof Error ? `Image upload failed: ${err.message}` : 'Image upload failed',
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { fileId?: string; filePath?: string; size?: number; message?: string }
    | null;

  if (!res.ok || !body?.fileId || !body.filePath) {
    // Surface ImageKit's own message — a 400 here is usually a real, fixable reason.
    throw AppError.badRequest(
      `Image upload failed: ${body?.message ?? res.statusText}`,
    );
  }

  return {
    fileId: body.fileId,
    filePath: body.filePath,
    byteSize: body.size ?? file.buffer.byteLength,
  };
}

/**
 * Mint a signed, expiring URL for a private file.
 *
 * The signature covers the path AND the expiry, so neither can be tampered with: bump the
 * timestamp and the signature no longer matches.
 */
export function signedUrl(env: Env, filePath: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): {
  url: string;
  expiresAt: Date;
} {
  requireConfig(env);

  const endpoint = env.IMAGEKIT_URL_ENDPOINT!.replace(/\/$/, '');
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;

  const base = `${endpoint}${filePath.startsWith('/') ? '' : '/'}${filePath}`;

  // ImageKit signs (everything after the URL endpoint) + (the expiry), with the private key.
  const toSign = base.replace(`${endpoint}/`, '') + expiry;

  const signature = createHmac('sha1', env.IMAGEKIT_PRIVATE_KEY!)
    .update(toSign)
    .digest('hex');

  return {
    url: `${base}?ik-t=${expiry}&ik-s=${signature}`,
    expiresAt: new Date(expiry * 1000),
  };
}

export async function deleteImage(env: Env, fileId: string): Promise<void> {
  requireConfig(env);

  try {
    const res = await fetch(`${API_URL}/${fileId}`, {
      method: 'DELETE',
      headers: { authorization: auth(env) },
    });

    // A 404 means it is already gone, which is the state we wanted anyway.
    if (!res.ok && res.status !== 404) {
      throw new Error(res.statusText);
    }
  } catch (err) {
    /**
     * A failed remote delete must not block the local one.
     *
     * If it did, a user asking us to forget an image would be told "no" because a third
     * party was having a bad day, and the image would stay in our database too. Better to
     * drop our record and leave an orphan at ImageKit than to refuse the deletion.
     */
    throw new OrphanedImageError(fileId, err instanceof Error ? err.message : 'unknown');
  }
}

export class OrphanedImageError extends Error {
  constructor(
    readonly fileId: string,
    reason: string,
  ) {
    super(`Could not delete image ${fileId} from storage: ${reason}`);
    this.name = 'OrphanedImageError';
  }
}
