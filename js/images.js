// File -> downscaled JPEG Blob, plus cached object URLs for display.
//
// Phone photos arrive at several MB each. They are downscaled on import so the
// stored data stays small - which matters now for the IndexedDB quota, and
// later for the size of what gets committed to the repo.

const MAX_EDGE = 1400;
const QUALITY = 0.82;

export async function fileToImageBlob(file, options) {
  const { maxEdge = MAX_EDGE, quality = QUALITY } = options || {};

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob || file; // toBlob can return null on exotic input; keep the original
}

export async function filesToImageBlobs(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));

  // Sequential on purpose: the picker order is the exercise's action sequence,
  // and decoding ten full-size photos at once spikes memory for no gain.
  const blobs = [];
  for (const file of files) blobs.push(await fileToImageBlob(file));
  return blobs;
}

// One object URL per Blob, reused across re-renders so URLs are not leaked.
const urlCache = new WeakMap();

export function blobUrl(blob) {
  if (!blob) return '';
  if (typeof blob === 'string') return blob; // already a URL

  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
  }
  return url;
}

// --- content addressing ------------------------------------------------------

// Images are stored under the hash of their own bytes, which buys three things
// at once: the name can never go stale on the other device, identical images
// dedupe themselves, and the file is immutable so it can be cached for ever.
// Only the two JSON files ever need re-reading.
//
// 16 hex characters is 64 bits - collisions are not a consideration at any
// number of exercises a person will ever have.
export async function hashImage(blob) {
  const bytes = await blobBytes(blob);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
