export type Contact = {
  id: string;
  name: string;
  company: string;
  designation: string;
  mobiles: string[];
  phones: string[];
  emails: string[];
  website: string;
  address: string;
  event: string;
  notes: string;
  photo?: string; // small JPEG data URL of the card (front)
  createdAt: string;
  googleResourceName?: string;
};

export type ExtractedCard = Pick<
  Contact,
  "name" | "company" | "designation" | "mobiles" | "phones" | "emails" | "website" | "address" | "notes"
>;

export function emptyContact(): Contact {
  return {
    id: crypto.randomUUID(),
    name: "",
    company: "",
    designation: "",
    mobiles: [""],
    phones: [],
    emails: [""],
    website: "",
    address: "",
    event: "",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

/** Drop empty entries and trim everything before saving. */
export function cleanContact(c: Contact): Contact {
  const list = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
  return {
    ...c,
    name: c.name.trim(),
    company: c.company.trim(),
    designation: c.designation.trim(),
    mobiles: list(c.mobiles),
    phones: list(c.phones),
    emails: list(c.emails),
    website: c.website.trim(),
    address: c.address.trim(),
    event: c.event.trim(),
    notes: c.notes.trim(),
  };
}

export function displayName(c: Contact) {
  return c.name || c.company || c.emails[0] || c.mobiles[0] || "Unnamed contact";
}

export function validate(c: Contact): string | null {
  const cc = cleanContact(c);
  if (!cc.name && !cc.company && !cc.mobiles.length && !cc.phones.length && !cc.emails.length) {
    return "Add at least a name, company, phone or email.";
  }
  for (const e of cc.emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return `"${e}" doesn't look like a valid email.`;
  }
  for (const p of [...cc.mobiles, ...cc.phones]) {
    const digits = p.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 16 || /[^\d+\s\-().]/.test(p)) {
      return `"${p}" doesn't look like a valid phone number.`;
    }
  }
  return null;
}

// ---------- Local storage ----------
const KEY = "cardkeep.contacts.v1";

export function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Contact[]) : [];
  } catch {
    return [];
  }
}

export function saveContacts(list: Contact[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full (photos) - retry without photos so contact data is never lost
    try {
      localStorage.setItem(KEY, JSON.stringify(list.map((c) => ({ ...c, photo: undefined }))));
    } catch {
      /* ignore */
    }
  }
}

// ---------- CSV ----------
export function toCSV(list: Contact[]) {
  const header = ["Name", "Company", "Designation", "Mobile", "Phone", "Email", "Website", "Address", "Event", "Notes", "Date"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = list.map((c) =>
    [
      c.name,
      c.company,
      c.designation,
      c.mobiles.join(" / "),
      c.phones.join(" / "),
      c.emails.join(" / "),
      c.website,
      c.address,
      c.event,
      c.notes,
      new Date(c.createdAt).toLocaleDateString(),
    ]
      .map(esc)
      .join(","),
  );
  return "﻿" + [header.map(esc).join(","), ...rows].join("\r\n");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(s: string) {
  return (s || "contact").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 40) || "contact";
}
