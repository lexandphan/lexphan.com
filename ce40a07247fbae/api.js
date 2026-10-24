// The rank-api client. `base` is the function URL the page was opened with: the signed link (it carries e and s)
// or, inside Telegram, the bare one from the button (then the Mini App's init data goes out as a header). The host
// is pinned by its SHA-256, as on the finds page, so a link to someone else's project can't fill this page and
// the public repo holds no project identifier.
const HOST_SHA256 = "05d1f5821e5c40d1d6a40dab6d83055bfc5f816d052be84f9271ba680f9f6a89";
export const api = { base: null, initData: null };

async function hostOk(host) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("") === HOST_SHA256;
}
export function unb64url(s) {
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return atob(b + "=".repeat((4 - (b.length % 4)) % 4));
}
/** A rank-api URL from a base64url param, or null: https, *.supabase.co, the rank-api path, the pinned host. */
export async function apiUrl(raw) {
  try {
    const url = new URL(unb64url(raw));
    if (url.protocol !== "https:" || !/\.supabase\.co$/.test(url.hostname)) return null;
    if (url.pathname !== "/functions/v1/rank-api") return null;
    if (!(await hostOk(url.hostname))) return null;
    return url;
  } catch { return null; }
}
export class Gone extends Error {}
/** One call. Route params are added to the base (which keeps e and s in link mode). 409 → { stale: true, view };
 *  404 → Gone (the credential is dead; the caller shows how to get a fresh one). */
export async function call(method, params, body) {
  const url = new URL(api.base);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const headers = {};
  if (api.initData) headers["x-tg-init-data"] = api.initData;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, referrerPolicy: "no-referrer" });
  if (res.status === 404) throw new Gone();
  if (res.status === 409) return await res.json();
  if (!res.ok) throw new Error(`http ${res.status}`);
  return await res.json();
}
