import type { ExtractedCard } from "./contacts";

/**
 * Free, on-device card reading with Tesseract (no API key, nothing leaves the phone).
 * Engine + English data are self-hosted in /public/tesseract.
 */

type Line = { text: string; height: number; top: number };

type TWorker = {
  recognize: (img: string) => Promise<{
    data: { text: string; lines?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] };
  }>;
};

let workerPromise: Promise<TWorker> | null = null;

function getWorker(): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tesseract",
        gzip: true,
      });
      return w as unknown as TWorker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Start downloading the engine early so the first scan is faster. */
export function warmUpLocalOcr() {
  getWorker().catch(() => null);
}

/** Upscale small images, convert to grayscale and stretch contrast — helps OCR a lot. */
async function prepare(dataURL: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataURL;
  });
  const target = 2000;
  const scale = Math.min(2.5, target / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  let min = 255, max = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  // Light text on dark card → invert so text is dark
  let sum = 0;
  for (let j = 0; j < gray.length; j++) sum += gray[j];
  const invert = sum / gray.length < 110;
  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v = ((gray[j] - min) * 255) / range;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

export async function readCardLocally(images: string[]): Promise<ExtractedCard> {
  const worker = await getWorker();
  const lines: Line[] = [];
  for (const img of images) {
    const { data } = await worker.recognize(await prepare(img));
    const src = data.lines?.length
      ? data.lines
          .filter((l) => l.confidence > 30)
          .map((l) => ({ text: l.text, height: l.bbox.y1 - l.bbox.y0, top: l.bbox.y0 }))
      : data.text.split("\n").map((t, i) => ({ text: t, height: 0, top: i }));
    lines.push(...src);
  }
  return parseCardText(lines);
}

// ---------------------------------------------------------------------------
// Text → fields
// ---------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|ae|pk|in|co|io|biz|info|uk|sa|qa|om|bh|kw|eg|us|ca|au|de|fr|me|ai|app|tech|online|store|site|global|group)(?:\.[a-z]{2})?)(?:\/[^\s]*)?\b/i;
const PHONE_RE = /(\+?\(?\d[\d\s().\-–]{6,}\d)/g;

const TITLE_WORDS =
  /\b(ceo|cto|cfo|coo|cmo|founder|co-?founder|owner|partner|president|vice|vp|director|manager|head|lead|leader|chief|officer|executive|engineer|developer|designer|consultant|specialist|analyst|advisor|adviser|associate|assistant|coordinator|supervisor|administrator|accountant|architect|representative|agent|sales|marketing|chairman|secretary|principal|doctor|dr\.?|lawyer|advocate|attorney|broker|technician|trainer|teacher|professor|intern|gm|md)\b/i;

const COMPANY_WORDS =
  /\b(llc|l\.l\.c|ltd|limited|inc|corp|corporation|co\.|company|group|holding|holdings|trading|enterprises?|industries|international|intl|solutions|services|technologies|technology|tech|systems|consulting|consultants|partners|associates|agency|studio|labs?|bank|fze|fzco|fz-llc|est\.?|establishment|pvt|private|gmbh|s\.a|plc|properties|realty|real estate|logistics|group)\b/i;

const ADDRESS_WORDS =
  /\b(street|st\.|road|rd\.?|avenue|ave|blvd|boulevard|lane|floor|flr|building|bldg|tower|office|suite|unit|block|plot|p\.?\s?o\.?\s?box|po box|city|district|area|sector|near|dubai|abu dhabi|sharjah|ajman|uae|united arab emirates|riyadh|jeddah|doha|qatar|muscat|oman|bahrain|kuwait|karachi|lahore|islamabad|pakistan|india|london|zip|postal)\b/i;

const LABEL_RE =
  /^\s*(?:(?:name|mob(?:ile)?|cell|tel(?:ephone)?|ph(?:one)?|fax|e-?mail|web(?:site)?|address|addr|whatsapp)\s*[:.\-]?\s+|(?:office|m|t|p|e|w|f|a)\s*[:.\-]\s*)/i;

function clean(s: string) {
  return s
    .replace(/[|_~`^*•©®™]+/g, " ")
    .replace(/^[^A-Za-z0-9+(]+/, "") // logo/icon symbols at the start
    .replace(/\s{2,}/g, " ")
    .trim();
}

function digitsOf(s: string) {
  return s.replace(/\D/g, "");
}

function normalizePhone(raw: string) {
  let p = raw.replace(/[–]/g, "-").replace(/[^\d+()\s-]/g, "").replace(/\s{2,}/g, " ").trim();
  p = p.replace(/^[-\s]+|[-\s]+$/g, "");
  return p;
}

function isMostlyLetters(s: string) {
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= Math.max(3, s.replace(/\s/g, "").length * 0.8);
}

function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function parseCardText(input: Line[]): ExtractedCard {
  const lines = input.map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text.length > 1);
  const used = new Set<number>();
  const emails: string[] = [];
  const mobiles: string[] = [];
  const phones: string[] = [];
  let website = "";

  lines.forEach((l, i) => {
    let t = l.text;

    // Emails
    const em = t.match(EMAIL_RE);
    if (em) {
      em.forEach((e) => {
        const v = e.replace(/\s/g, "").toLowerCase();
        if (!emails.includes(v)) emails.push(v);
      });
      t = t.replace(EMAIL_RE, " ");
      used.add(i);
    }

    // Phones
    const lower = l.text.toLowerCase();
    const isFax = /\bfax\b|\bf\s*[:.]/.test(lower);
    const ph = t.match(PHONE_RE);
    if (ph) {
      ph.forEach((raw) => {
        const d = digitsOf(raw);
        if (d.length < 7 || d.length > 15) return;
        if (isFax) return;
        const v = normalizePhone(raw);
        const mobileHint =
          /\b(m|mob|mobile|cell|whatsapp|wa)\b/.test(lower) ||
          /^(\+?971|00971)\s*-?\(?0?\)?\s*5\d/.test(v.replace(/[()\s-]/g, "")) ||
          /^05\d/.test(d) ||
          /^(\+?92|0092)3\d/.test(v.replace(/[()\s-]/g, "")) ||
          /^03\d{9}$/.test(d);
        const landHint = /\b(t|tel|telephone|ph|phone|office|landline|direct|board)\b/.test(lower);
        if (mobiles.includes(v) || phones.includes(v)) return;
        if (landHint && !mobileHint) phones.push(v);
        else mobiles.push(v);
      });
      t = t.replace(PHONE_RE, " ");
      used.add(i);
    }

    // Website
    if (!website) {
      const u = t.match(URL_RE);
      if (u && !u[0].includes("@")) {
        website = u[1].replace(/^https?:\/\//i, "").toLowerCase();
        used.add(i);
      }
    } else if (URL_RE.test(t) && !t.includes("@")) {
      used.add(i);
    }

    // Lines that are now only labels/punctuation
    if (used.has(i) && clean(t.replace(LABEL_RE, "")).replace(/[^A-Za-z]/g, "").length < 3) used.add(i);
  });

  // If no website, derive from email domain (unless a free mail provider)
  if (!website && emails[0]) {
    const dom = emails[0].split("@")[1];
    if (!/^(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail|ymail|msn)\./.test(dom)) website = dom;
  }

  // Remaining text lines
  const rest = lines
    .map((l, i) => ({ ...l, i, text: l.text.replace(LABEL_RE, "").trim() }))
    .filter((l) => !used.has(l.i) && /[A-Za-z]{2,}/.test(l.text));

  // Address: lines with address words or that look like "123 Something"
  const addressLines = rest.filter((l) => ADDRESS_WORDS.test(l.text) && !TITLE_WORDS.test(l.text));
  addressLines.forEach((l) => used.add(l.i));
  const address = addressLines.map((l) => l.text.replace(/^(address|addr)\s*[:.]?\s*/i, "")).join(", ");

  const remaining = rest.filter((l) => !used.has(l.i));

  // Designation
  const desig = remaining.find((l) => TITLE_WORDS.test(l.text) && !COMPANY_WORDS.test(l.text) && l.text.split(/\s+/).length <= 7);
  if (desig) used.add(desig.i);

  // Company: explicit company words, else line matching website/email domain
  let companyLine = remaining.find((l) => !used.has(l.i) && COMPANY_WORDS.test(l.text));
  if (!companyLine) {
    const domainWord = (website || emails[0]?.split("@")[1] || "").split(".").filter((p) => p !== "www")[0];
    if (domainWord && domainWord.length >= 3) {
      companyLine = remaining.find(
        (l) => !used.has(l.i) && l.text.toLowerCase().replace(/[^a-z]/g, "").includes(domainWord.toLowerCase().replace(/[^a-z]/g, "")),
      );
    }
  }
  if (companyLine) {
    used.add(companyLine.i);
    // Logo text split over two lines, e.g. "Northline" / "Group"
    const prev = remaining.find((l) => l.i === companyLine!.i - 1);
    if (companyLine.text.split(/\s+/).length === 1 && prev && !used.has(prev.i) && isMostlyLetters(prev.text) && prev.text.split(/\s+/).length <= 2 && !TITLE_WORDS.test(prev.text)) {
      companyLine = { ...companyLine, text: `${prev.text} ${companyLine.text}` };
      used.add(prev.i);
    }
  }

  // Name: 2–4 letter words, not company/title; prefer the line just above designation, else the tallest text
  const nameCandidates = remaining.filter((l) => {
    if (used.has(l.i)) return false;
    const words = l.text.split(/\s+/);
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      isMostlyLetters(l.text) &&
      !COMPANY_WORDS.test(l.text) &&
      !TITLE_WORDS.test(l.text) &&
      !/contact|thank|welcome|scan|follow/i.test(l.text)
    );
  });
  const nameLine: (typeof nameCandidates)[number] | undefined =
    (desig && nameCandidates.find((l) => l.i === desig.i - 1)) ||
    [...nameCandidates].sort((a, b) => b.height - a.height)[0];
  if (nameLine) used.add(nameLine.i);

  // Company fallback: biggest leftover short text that isn't the name
  if (!companyLine) {
    companyLine = remaining
      .filter((l) => !used.has(l.i) && l.text.split(/\s+/).length <= 5 && isMostlyLetters(l.text) && !/contact/i.test(l.text))
      .sort((a, b) => b.height - a.height)[0];
    if (companyLine && nameLine && companyLine.height < nameLine.height * 0.6) companyLine = undefined;
    if (companyLine) used.add(companyLine.i);
  }

  return {
    name: nameLine ? titleCase(nameLine.text.replace(/[^A-Za-z.'\-\s]/g, "").trim()) : "",
    company: companyLine ? companyLine.text.trim() : "",
    designation: desig ? desig.text.trim() : "",
    mobiles,
    phones,
    emails,
    website,
    address,
    notes: "",
  };
}
