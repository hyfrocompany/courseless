// Everything that leaves this app for the operating system's browser goes through here first.
//
// `shell.openExternal` hands a string to the OS, which will happily launch a helper for `file:`,
// `smb:`, `ms-msdt:` or any other registered scheme. The strings we pass it come from two places
// that are not fully ours: a URL the renderer asked to open (lesson content can carry links), and
// a URL a backend response handed back. Neither is dangerous today; both are one edit away from
// being a way to reach the OS through Courseless. So the rule is narrow and lives in one file.

import { log } from './log'

/**
 * The only scheme allowed out. Not http: a downgrade is never something we need to offer, and a
 * plain-text link is exactly what an interception would want us to open.
 */
function httpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  return url.protocol === 'https:' ? url : null
}

/** `stripe.com` itself or a subdomain of it — never `notstripe.com`. */
function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * A URL the app may hand to the browser on the learner's behalf: any https link.
 *
 * Returns the normalised URL, or null with a log line. Callers treat null as "did not open".
 */
export function externalUrl(raw: unknown, why: string): string | null {
  const url = httpsUrl(raw)
  if (!url) {
    log('links', 'refused to open a non-https url', why, String(raw).slice(0, 80))
    return null
  }
  return url.toString()
}

/**
 * A checkout or billing-portal URL. Stricter than `externalUrl` because this one is followed
 * automatically, with no click in between: the learner presses "Upgrade" here and lands on a
 * payment page there. Only Stripe's own hosts and our own site qualify, so a compromised or
 * mistaken backend response cannot send someone to a look-alike card form.
 */
export function billingUrl(raw: unknown, siteUrl: string): string | null {
  const url = httpsUrl(raw)
  if (!url) {
    log('links', 'refused a non-https billing url', String(raw).slice(0, 80))
    return null
  }
  let siteHost = ''
  try {
    siteHost = new URL(siteUrl).hostname
  } catch {
    /* no site configured — Stripe's hosts are still allowed */
  }
  const allowed =
    isHostOrSubdomain(url.hostname, 'stripe.com') ||
    (!!siteHost && isHostOrSubdomain(url.hostname, siteHost))
  if (!allowed) {
    log('links', 'refused a billing url on an unexpected host', url.hostname)
    return null
  }
  return url.toString()
}
