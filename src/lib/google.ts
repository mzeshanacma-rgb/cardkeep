import { Contact } from "./contacts";

/* Minimal typings for Google Identity Services token client */
type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

const SCOPE = "https://www.googleapis.com/auth/contacts";
const API = "https://people.googleapis.com/v1";
const TOKEN_KEY = "cardkeep.gtoken";
const GROUP_NAME = "CardKeep";

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

let gisPromise: Promise<void> | null = null;
function loadGIS(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error("Couldn't load Google sign-in. Check your connection."));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function cachedToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    return Date.now() < exp - 60_000 ? token : null;
  } catch {
    return null;
  }
}

export function isGoogleConnected() {
  return !!cachedToken();
}

export async function getGoogleToken(forcePrompt = false): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google sign-in isn't set up yet (NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing).");
  }
  if (!forcePrompt) {
    const t = cachedToken();
    if (t) return t;
  }
  await loadGIS();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || "Google sign-in failed."));
          return;
        }
        try {
          sessionStorage.setItem(
            TOKEN_KEY,
            JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }),
          );
        } catch {
          /* ignore */
        }
        resolve(r.access_token);
      },
      error_callback: (e) =>
        reject(new Error(e.type === "popup_closed" ? "Google sign-in was closed." : e.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
  });
}

export function signOutGoogle() {
  const t = cachedToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (t && window.google) window.google.accounts.oauth2.revoke(t);
}

async function gfetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (res.status === 401) {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    throw new Error("Google session expired. Please try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Google API error (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function toPerson(c: Contact) {
  const parts = c.name.trim().split(/\s+/).filter(Boolean);
  const givenName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "";
  const familyName = parts.length > 1 ? parts[parts.length - 1] : "";
  const met = c.event ? `Met at ${c.event} on ${new Date(c.createdAt).toLocaleDateString()}` : "";
  const bio = [met, c.notes, "Saved with CardKeep"].filter(Boolean).join("\n");
  return {
    names: c.name ? [{ givenName, familyName, unstructuredName: c.name }] : [],
    organizations: c.company || c.designation ? [{ name: c.company, title: c.designation, type: "work" }] : [],
    phoneNumbers: [
      ...c.mobiles.map((value) => ({ value, type: "mobile" })),
      ...c.phones.map((value) => ({ value, type: "work" })),
    ],
    emailAddresses: c.emails.map((value) => ({ value, type: "work" })),
    urls: c.website ? [{ value: c.website.startsWith("http") ? c.website : `https://${c.website}`, type: "work" }] : [],
    addresses: c.address ? [{ formattedValue: c.address, streetAddress: c.address, type: "work" }] : [],
    biographies: bio ? [{ value: bio, contentType: "TEXT_PLAIN" }] : [],
  };
}

type Person = { resourceName: string; etag: string; names?: { displayName?: string }[] };

/** Look for an existing Google contact with the same email or phone. */
export async function findDuplicate(token: string, c: Contact): Promise<Person | null> {
  const queries = [...c.emails, ...c.mobiles, ...c.phones].filter(Boolean).slice(0, 3);
  if (!queries.length) return null;
  // Warm-up request recommended by Google before searchContacts
  await gfetch(token, `/people:searchContacts?query=&readMask=names`).catch(() => null);
  for (const q of queries) {
    const r = await gfetch<{ results?: { person: Person }[] }>(
      token,
      `/people:searchContacts?query=${encodeURIComponent(q)}&readMask=names,emailAddresses,phoneNumbers&pageSize=5`,
    ).catch(() => ({ results: [] as { person: Person }[] }));
    if (r.results?.length) return r.results[0].person;
  }
  return null;
}

async function ensureGroup(token: string): Promise<string | null> {
  try {
    const r = await gfetch<{ contactGroups?: { resourceName: string; name: string; groupType: string }[] }>(
      token,
      `/contactGroups?pageSize=200`,
    );
    const found = r.contactGroups?.find((g) => g.name === GROUP_NAME && g.groupType === "USER_CONTACT_GROUP");
    if (found) return found.resourceName;
    const created = await gfetch<{ resourceName: string }>(token, `/contactGroups`, {
      method: "POST",
      body: JSON.stringify({ contactGroup: { name: GROUP_NAME } }),
    });
    return created.resourceName;
  } catch {
    return null; // label is optional
  }
}

export async function createGoogleContact(token: string, c: Contact): Promise<string> {
  const person = await gfetch<Person>(token, `/people:createContact?personFields=names`, {
    method: "POST",
    body: JSON.stringify(toPerson(c)),
  });
  const group = await ensureGroup(token);
  if (group) {
    await gfetch(token, `/${group}/members:modify`, {
      method: "POST",
      body: JSON.stringify({ resourceNamesToAdd: [person.resourceName] }),
    }).catch(() => null);
  }
  return person.resourceName;
}

export async function updateGoogleContact(token: string, existing: Person, c: Contact): Promise<string> {
  const fields = "names,organizations,phoneNumbers,emailAddresses,urls,addresses,biographies";
  const current = await gfetch<Person>(token, `/${existing.resourceName}?personFields=metadata`);
  const person = await gfetch<Person>(token, `/${existing.resourceName}:updateContact?updatePersonFields=${fields}`, {
    method: "PATCH",
    body: JSON.stringify({ ...toPerson(c), etag: current.etag }),
  });
  return person.resourceName;
}

export function googleContactUrl(resourceName?: string) {
  const id = resourceName?.split("/")[1];
  return id ? `https://contacts.google.com/person/${id}` : "https://contacts.google.com";
}
