/// <reference types="vite/client" />

/**
 * Resolves a public static asset path against Vite's `BASE_URL` (`/` on Vercel,
 * `./` on itch.io HTML5 builds), stripping any leading slash so assets load
 * reliably from both root domains and subpath iframes.
 */
export function resolveAssetUrl(relPath: string): string {
  if (/^(https?:)?\/\//i.test(relPath) || relPath.startsWith('data:') || relPath.startsWith('blob:')) {
    return relPath;
  }
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${prefix}${cleanPath}`;
}
