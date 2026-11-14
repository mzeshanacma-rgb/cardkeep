import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const CardSchema = z.object({
  name: z.string(),
  company: z.string(),
  designation: z.string(),
  mobiles: z.array(z.string()),
  phones: z.array(z.string()),
  emails: z.array(z.string()),
  website: z.string(),
  address: z.string(),
  notes: z.string(),
});

const SYSTEM_PROMPT = `You read photos of business / visiting cards and extract contact details.

Rules:
- Only use text that is actually printed on the card. Never guess, infer or invent anything.
- If a field is missing, cut off or unreadable, return an empty string (or an empty array).
- "mobiles" = mobile/cell numbers (often marked M, Mob, Cell, or WhatsApp). "phones" = landline/office/fax-free numbers (Tel, Ph, Office). If you can't tell, put it in "mobiles".
- Format phone numbers in international format (e.g. +971 50 123 4567) only when the country code is printed on the card or the country is clearly shown on the card (e.g. address). Otherwise keep the number exactly as printed.
- Keep names in their original spelling. If the card shows both English and Arabic/Urdu text, use the English (Latin) version for the fields and put the other-language name in "notes".
- "website": the main website only, without "http://".
- "address": the full postal address on one line.
- "notes": anything else useful printed on the card (e.g. second language name, P.O. Box, fax, LinkedIn, services). Keep it short.
- If several images are given, they are the front and back of the same card: merge them into one contact.`;

type IncomingImage = { data: string; mediaType: string };
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // No key configured: the browser falls back to free on-device reading
    return Response.json({ error: "AI reading is not configured.", code: "NO_KEY" }, { status: 503 });
  }

  let images: IncomingImage[];
  try {
    const body = await req.json();
    images = body.images;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(images) || images.length === 0 || images.length > 2) {
    return Response.json({ error: "Send 1 or 2 card images." }, { status: 400 });
  }
  for (const img of images) {
    if (!ALLOWED_TYPES.includes(img.mediaType as AllowedType) || typeof img.data !== "string") {
      return Response.json({ error: "Unsupported image type." }, { status: 400 });
    }
    if (img.data.length > 6_000_000) {
      return Response.json({ error: "Image is too large." }, { status: 413 });
    }
  }

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: betaZodOutputFormat(CardSchema),
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType as AllowedType,
                data: img.data,
              },
            })),
            {
              type: "text" as const,
              text:
                images.length > 1
                  ? "These are the front and back of one business card. Extract the contact details."
                  : "Extract the contact details from this business card.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json(
        { error: "Couldn't read this card. Please fill the details manually." },
        { status: 422 },
      );
    }

    return Response.json({ contact: response.parsed_output });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Too many requests. Try again in a moment." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Invalid ANTHROPIC_API_KEY on the server." }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return Response.json({ error: "Card reading service error. Please try again." }, { status: 502 });
    }
    console.error(err);
    return Response.json({ error: "Unexpected error while reading the card." }, { status: 500 });
  }
}
