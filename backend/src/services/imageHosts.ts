import { getExtraImageHosts } from '../config/appConfig';
import { scraperManager } from '../plugins/scraperLoader';

/**
 * Which hosts artwork may be downloaded from.
 *
 * `safeFetch` decides whether a URL points somewhere dangerous; this decides
 * whether it points somewhere the artwork could plausibly have come from. They
 * answer different questions and neither replaces the other: a compromised or
 * merely wrong provider pointing at an unrelated public host is not a security
 * boundary being crossed, it is artwork arriving from somewhere nobody asked
 * for, cached under a name that says a scraper chose it.
 *
 * The list is the union of what every installed scraper declares, plus
 * `images.allowedHosts` from `tubeca.config.json`. Deliberately not per
 * scraper: the only caller that names one is the download route, and it takes
 * that name from the request body, so keying the rule on it would let the
 * caller choose which rule to be judged by. A union of the hosts actually
 * installed is not something a request can widen.
 */

/** Every host the installed scrapers and the config between them allow. */
export function allowedImageHosts(): string[] {
  const declared = scraperManager
    .getAll()
    .flatMap((plugin) => plugin.imageHosts ?? [])
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...declared, ...getExtraImageHosts()])];
}

/**
 * Why a URL's host is not one artwork comes from, or null when it is fine.
 *
 * When nothing declares a host — no scraper installed declares one and the
 * config adds none — there is nothing to check against, and every URL passes.
 * A check with an empty list would refuse everything, which is not a safer
 * failure than not checking: it would simply break artwork for anyone running
 * a scraper that predates `imageHosts`.
 */
export function imageHostRefusalReason(url: string): string | null {
  const allowed = allowedImageHosts();
  if (allowed.length === 0) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Not a URL';
  }

  // Exact matches only. `image.tmdb.org.example.com` is a different host, and
  // a suffix test is how that gets missed.
  if (allowed.includes(hostname)) return null;

  return `${hostname} is not a host artwork comes from (${allowed.join(', ')})`;
}
