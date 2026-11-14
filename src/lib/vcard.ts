import { Contact, downloadBlob, safeFilename } from "./contacts";

const esc = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** Fold long lines at 75 chars as required by the vCard spec. */
function fold(line: string) {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join("\r\n");
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function contactToVCard(c: Contact, includePhoto = true) {
  const { first, last } = splitName(c.name);
  const fn = c.name || c.company || "Contact";
  const met = c.event ? `Met at ${c.event} on ${new Date(c.createdAt).toLocaleDateString()}` : "";
  const note = [met, c.notes].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(fn)}`,
  ];
  if (c.company) lines.push(`ORG:${esc(c.company)}`);
  if (c.designation) lines.push(`TITLE:${esc(c.designation)}`);
  c.mobiles.forEach((m) => lines.push(`TEL;TYPE=CELL:${esc(m)}`));
  c.phones.forEach((p) => lines.push(`TEL;TYPE=WORK,VOICE:${esc(p)}`));
  c.emails.forEach((e) => lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(e)}`));
  if (c.website) lines.push(`URL:${esc(c.website.startsWith("http") ? c.website : "https://" + c.website)}`);
  if (c.address) lines.push(`ADR;TYPE=WORK:;;${esc(c.address)};;;;`);
  if (note) lines.push(`NOTE:${esc(note)}`);
  if (c.event) lines.push(`CATEGORIES:${esc(c.event)}`);
  if (includePhoto && c.photo?.startsWith("data:image/jpeg;base64,")) {
    lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${c.photo.split(",")[1]}`);
  }
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Save to phone: on mobile, open the share sheet with the .vcf file (user picks "Contacts").
 * Otherwise download the .vcf, which opens the Add Contact screen on iPhone/Android.
 */
export async function saveToPhone(c: Contact): Promise<"shared" | "downloaded" | "cancelled"> {
  const filename = `${safeFilename(c.name || c.company)}.vcf`;
  const vcf = contactToVCard(c);
  const file = new File([vcf], filename, { type: "text/vcard" });

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: c.name || "Contact" });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // fall through to download
    }
  }
  downloadBlob(new Blob([vcf], { type: "text/vcard;charset=utf-8" }), filename);
  return "downloaded";
}

export function exportAllVCards(list: Contact[]) {
  const all = list.map((c) => contactToVCard(c, false)).join("");
  downloadBlob(new Blob([all], { type: "text/vcard;charset=utf-8" }), `cardkeep_contacts_${list.length}.vcf`);
}
