"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveCamera from "./LiveCamera";
import {
  CameraIcon, DownloadIcon, EditIcon, GoogleIcon, ImageIcon, PlusIcon, RotateIcon,
  SaveIcon, SearchIcon, TrashIcon, VideoIcon, XIcon,
} from "./icons";
import {
  Contact, ExtractedCard, cleanContact, displayName, downloadBlob, emptyContact,
  loadContacts, saveContacts, toCSV, validate,
} from "@/lib/contacts";
import { dataURLParts, fileToDataURL, processImage } from "@/lib/image";
import { exportAllVCards, saveToPhone } from "@/lib/vcard";
import {
  GOOGLE_CLIENT_ID, createGoogleContact, findDuplicate, getGoogleToken, googleContactUrl,
  isGoogleConnected, signOutGoogle, updateGoogleContact,
} from "@/lib/google";

type Tab = "scan" | "saved";
type Side = "front" | "back";
type Toast = { kind: "success" | "error" | "info"; text: string; link?: { href: string; label: string } } | null;
type DupChoice = "update" | "create" | "cancel";

export default function CardKeepApp() {
  const [tab, setTab] = useState<Tab>("scan");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<Contact>(emptyContact);
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "phone" | "google" | "local">(null);
  const [toast, setToast] = useState<Toast>(null);
  const [camera, setCamera] = useState<Side | null>(null);
  const [googleOn, setGoogleOn] = useState(false);
  const [dup, setDup] = useState<{ name: string; resolve: (c: DupChoice) => void } | null>(null);
  const [lastEvent, setLastEvent] = useState("");

  const takeRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<Side>("front");
  const extractSeq = useRef(0);

  useEffect(() => {
    setContacts(loadContacts());
    setGoogleOn(isGoogleConnected());
    try {
      setLastEvent(localStorage.getItem("cardkeep.lastEvent") || "");
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveContacts(contacts);
  }, [contacts, loaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.link ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Prefill event with the last one used (handy when scanning many cards at one event)
  useEffect(() => {
    if (lastEvent) setForm((f) => (f.event ? f : { ...f, event: lastEvent }));
  }, [lastEvent]);

  // ---------- Extraction ----------
  const extract = useCallback(async (frontImg: string, backImg: string | null) => {
    const seq = ++extractSeq.current;
    setExtracting(true);
    setExtractError(null);
    try {
      const images = [frontImg, backImg].filter(Boolean).map((d) => dataURLParts(d!));
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const body = await res.json().catch(() => ({}));
      if (seq !== extractSeq.current) return;
      if (!res.ok) throw new Error(body.error || "Couldn't read the card.");
      const card = body.contact as ExtractedCard;
      setForm((f) => ({
        ...f,
        name: card.name || "",
        company: card.company || "",
        designation: card.designation || "",
        mobiles: card.mobiles?.length ? card.mobiles : [""],
        phones: card.phones || [],
        emails: card.emails?.length ? card.emails : [""],
        website: card.website || "",
        address: card.address || "",
        notes: card.notes || "",
      }));
    } catch (e) {
      if (seq === extractSeq.current) setExtractError((e as Error).message);
    } finally {
      if (seq === extractSeq.current) setExtracting(false);
    }
  }, []);

  const acceptImage = useCallback(
    async (raw: string, side: Side) => {
      try {
        const img = await processImage(raw, 1600);
        const thumb = await processImage(img, 480, 0, 0.7);
        if (side === "front") {
          setFront(img);
          setForm((f) => ({ ...f, photo: thumb }));
          extract(img, back);
        } else {
          setBack(img);
          if (front) extract(front, img);
        }
      } catch (e) {
        setToast({ kind: "error", text: (e as Error).message });
      }
    },
    [back, front, extract],
  );

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    acceptImage(await fileToDataURL(file), sideRef.current);
  };

  const openPicker = (side: Side, kind: "take" | "choose" | "live") => {
    sideRef.current = side;
    if (kind === "live") setCamera(side);
    else (kind === "take" ? takeRef : chooseRef).current?.click();
  };

  const rotate = async (side: Side) => {
    const src = side === "front" ? front : back;
    if (!src) return;
    const r = await processImage(src, 1600, 90);
    if (side === "front") {
      setFront(r);
      setForm((f) => ({ ...f, photo: undefined }));
      processImage(r, 480, 0, 0.7).then((t) => setForm((f) => ({ ...f, photo: t })));
      extract(r, back);
    } else {
      setBack(r);
      if (front) extract(front, r);
    }
  };

  const resetScan = () => {
    extractSeq.current++;
    setFront(null);
    setBack(null);
    setExtracting(false);
    setExtractError(null);
    setForm({ ...emptyContact(), event: lastEvent });
  };

  // ---------- Saving ----------
  const upsertLocal = (c: Contact) => {
    setContacts((list) => {
      const i = list.findIndex((x) => x.id === c.id);
      if (i === -1) return [c, ...list];
      const copy = [...list];
      copy[i] = c;
      return copy;
    });
    if (c.event) {
      setLastEvent(c.event);
      try {
        localStorage.setItem("cardkeep.lastEvent", c.event);
      } catch {
        /* ignore */
      }
    }
  };

  const askDuplicate = (name: string) => new Promise<DupChoice>((resolve) => setDup({ name, resolve }));

  const pushToGoogle = async (c: Contact): Promise<Contact | null> => {
    const token = await getGoogleToken();
    setGoogleOn(true);
    let resourceName = c.googleResourceName;
    if (resourceName) {
      resourceName = await updateGoogleContact(token, { resourceName, etag: "" }, c);
    } else {
      const existing = await findDuplicate(token, c);
      let choice: DupChoice = "create";
      if (existing) choice = await askDuplicate(existing.names?.[0]?.displayName || "an existing contact");
      if (choice === "cancel") return null;
      resourceName =
        choice === "update" && existing
          ? await updateGoogleContact(token, existing, c)
          : await createGoogleContact(token, c);
    }
    return { ...c, googleResourceName: resourceName };
  };

  const doSave = async (mode: "phone" | "google" | "local", source?: Contact) => {
    const fromForm = !source;
    const base = cleanContact(source || form);
    if (fromForm) {
      const err = validate(base);
      if (err) {
        setToast({ kind: "error", text: err });
        return;
      }
    }
    setBusy(mode);
    try {
      let saved = base;
      if (mode === "google") {
        const r = await pushToGoogle(base);
        if (!r) return;
        saved = r;
        upsertLocal(saved);
        setToast({
          kind: "success",
          text: `${displayName(saved)} saved to Google Contacts.`,
          link: { href: googleContactUrl(saved.googleResourceName), label: "Open" },
        });
      } else if (mode === "phone") {
        upsertLocal(saved);
        const r = await saveToPhone(saved);
        if (r === "cancelled") setToast({ kind: "info", text: "Saved in CardKeep. Sharing was cancelled." });
        else
          setToast({
            kind: "success",
            text:
              r === "shared"
                ? `${displayName(saved)} sent to your phone. Choose "Contacts" to add it.`
                : `${displayName(saved)}.vcf downloaded. Open it to add to your contacts.`,
          });
      } else {
        upsertLocal(saved);
        setToast({ kind: "success", text: `${displayName(saved)} saved in CardKeep.` });
      }
      if (fromForm) resetScan();
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const editContact = (c: Contact) => {
    extractSeq.current++;
    setForm({
      ...c,
      mobiles: c.mobiles.length ? c.mobiles : [""],
      emails: c.emails.length ? c.emails : [""],
    });
    setFront(c.photo || null);
    setBack(null);
    setExtractError(null);
    setExtracting(false);
    setTab("scan");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteContact = (c: Contact) => {
    if (!confirm(`Delete ${displayName(c)} from CardKeep? (It stays in your phone/Google if already saved there.)`)) return;
    setContacts((list) => list.filter((x) => x.id !== c.id));
  };

  const isEditingSaved = contacts.some((c) => c.id === form.id);

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <button onClick={() => setTab("scan")} className="text-xl font-bold tracking-tight">
            CardKeep
          </button>
          <nav className="mx-auto flex gap-1 sm:gap-4" aria-label="Main">
            {(
              [
                ["scan", "Scan Card"],
                ["saved", `Saved Contacts (${contacts.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`border-b-2 px-2 py-5 text-sm font-medium transition ${
                  tab === id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setTab("saved")}
            className="hidden rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-[var(--surface)] sm:block"
          >
            View Contacts
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {tab === "scan" ? (
          <>
            <h1 className="text-3xl font-bold tracking-tight">{isEditingSaved ? "Edit Contact" : "Scan Visiting Card"}</h1>
            <p className="mt-1 text-[var(--muted)]">Snap a card, fix anything needed, and save directly to your phone contacts.</p>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* Capture panel */}
              <section className="h-fit rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
                {!front ? (
                  <div className="rounded-2xl border-2 border-dashed border-[var(--line)] p-6 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <CameraIcon className="h-7 w-7" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold">Capture or Upload Card</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Keep the card flat and well-lit. Unclear or missing fields stay blank.
                    </p>
                    <CaptureButtons onPick={(k) => openPicker("front", k)} />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <CardPreview label="Front" src={front} onRotate={() => rotate("front")} onRetake={() => openPicker("front", "take")} />
                    {back ? (
                      <CardPreview
                        label="Back"
                        src={back}
                        onRotate={() => rotate("back")}
                        onRetake={() => openPicker("back", "take")}
                        onRemove={() => {
                          setBack(null);
                          extract(front, null);
                        }}
                      />
                    ) : (
                      !isEditingSaved && (
                        <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                          <p className="text-sm font-medium">Info on the back too? (optional)</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <SmallBtn onClick={() => openPicker("back", "take")}>
                              <CameraIcon className="h-4 w-4" /> Photo back side
                            </SmallBtn>
                            <SmallBtn onClick={() => openPicker("back", "choose")}>
                              <ImageIcon className="h-4 w-4" /> Upload back
                            </SmallBtn>
                          </div>
                        </div>
                      )
                    )}
                    {extracting && (
                      <div className="flex items-center gap-3 rounded-xl bg-[var(--brand-soft)] p-3 text-sm font-medium text-[var(--brand)]" role="status">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Reading card…
                      </div>
                    )}
                    {extractError && (
                      <div className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">
                        {extractError}{" "}
                        <button className="font-semibold underline" onClick={() => extract(front, back)}>
                          Try again
                        </button>
                      </div>
                    )}
                    <button onClick={resetScan} className="w-full rounded-xl border border-[var(--line)] py-2.5 text-sm font-medium hover:bg-[var(--bg)]">
                      {isEditingSaved ? "Cancel editing" : "Scan a different card"}
                    </button>
                  </div>
                )}
                {!front && isEditingSaved && (
                  <button onClick={resetScan} className="mt-4 w-full rounded-xl border border-[var(--line)] py-2.5 text-sm font-medium">
                    Cancel editing
                  </button>
                )}
              </section>

              {/* Form panel */}
              <section className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-4">
                  <h2 className="text-lg font-semibold">Review &amp; Edit Details</h2>
                  <span className="text-sm text-[var(--muted)]">Missing fields are always left blank</span>
                </div>

                <fieldset disabled={extracting} className={`mt-5 grid gap-4 sm:grid-cols-2 ${extracting ? "opacity-60" : ""}`}>
                  <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} autoComplete="off" />
                  <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
                  <Field label="Designation" value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} />
                  <MultiField label="Mobile" type="tel" values={form.mobiles} onChange={(v) => setForm({ ...form, mobiles: v })} />
                  {form.phones.length > 0 && (
                    <MultiField label="Office Phone" type="tel" values={form.phones} onChange={(v) => setForm({ ...form, phones: v })} />
                  )}
                  <MultiField label="Email" type="email" values={form.emails} onChange={(v) => setForm({ ...form, emails: v })} />
                  <Field label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} inputMode="url" />
                  <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} className="sm:col-span-2" />
                  <Field
                    label="Event"
                    value={form.event}
                    onChange={(v) => setForm({ ...form, event: v })}
                    placeholder="Where you met (e.g. Tech Summit, Chamber Mixer)"
                    className="sm:col-span-2"
                  />
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-sm font-medium">Notes</span>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={2}
                      placeholder="Anything to remember about this person"
                      className="input resize-y"
                    />
                  </label>
                  {form.phones.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, phones: [""] })}
                      className="flex items-center gap-1 text-sm font-medium text-[var(--brand)] sm:col-span-2"
                    >
                      <PlusIcon className="h-4 w-4" /> Add office phone
                    </button>
                  )}
                </fieldset>

                <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <PrimaryBtn onClick={() => doSave("phone")} busy={busy === "phone"} disabled={!!busy || extracting}>
                    <DownloadIcon /> Save &amp; Download to Phone
                  </PrimaryBtn>
                  <button
                    onClick={() => doSave("google")}
                    disabled={!!busy || extracting}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 font-semibold transition hover:bg-[var(--bg)] disabled:opacity-50"
                  >
                    {busy === "google" ? <Spinner /> : <GoogleIcon />} Save to Google Contacts
                  </button>
                  <button
                    onClick={() => doSave("local")}
                    disabled={!!busy || extracting}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 py-3 font-medium transition hover:bg-[var(--bg)] disabled:opacity-50 sm:col-span-2"
                  >
                    <SaveIcon /> Save Only (in CardKeep)
                  </button>
                </div>
                <GoogleStatus
                  on={googleOn}
                  onSignOut={() => {
                    signOutGoogle();
                    setGoogleOn(false);
                  }}
                />
              </section>
            </div>
          </>
        ) : (
          <SavedList
            contacts={contacts}
            onEdit={editContact}
            onDelete={deleteContact}
            onPhone={(c) => doSave("phone", c)}
            onGoogle={(c) => doSave("google", c)}
            busy={!!busy}
            onScan={() => {
              resetScan();
              setTab("scan");
            }}
          />
        )}
      </main>

      <input ref={takeRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={chooseRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {camera && (
        <LiveCamera
          onClose={() => setCamera(null)}
          onCapture={(d) => {
            const side = camera;
            setCamera(null);
            acceptImage(d, side);
          }}
        />
      )}

      {dup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Contact already in Google</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              A contact with the same email or phone already exists: <strong className="text-[var(--ink)]">{dup.name}</strong>. What would you like to do?
            </p>
            <div className="mt-5 grid gap-2">
              {(
                [
                  ["update", "Update existing contact", "bg-[var(--brand)] text-white"],
                  ["create", "Create a new contact", "border border-[var(--line)]"],
                  ["cancel", "Cancel", "text-[var(--muted)]"],
                ] as const
              ).map(([v, l, cls]) => (
                <button
                  key={v}
                  className={`rounded-xl px-4 py-3 font-medium ${cls}`}
                  onClick={() => {
                    dup.resolve(v);
                    setDup(null);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" role="status" aria-live="polite">
          <div
            className={`flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
              toast.kind === "error" ? "bg-red-600" : toast.kind === "info" ? "bg-slate-700" : "bg-emerald-600"
            }`}
          >
            <span>{toast.text}</span>
            {toast.link && (
              <a href={toast.link.href} target="_blank" rel="noreferrer" className="shrink-0 underline">
                {toast.link.label}
              </a>
            )}
            <button onClick={() => setToast(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Small components ----------

function CaptureButtons({ onPick }: { onPick: (k: "take" | "choose" | "live") => void }) {
  return (
    <div className="mt-5 space-y-3">
      <PrimaryBtn onClick={() => onPick("take")}>
        <CameraIcon /> Take Photo
      </PrimaryBtn>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onPick("choose")} className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--line)] bg-[var(--surface)] px-2 py-3 text-sm font-medium hover:bg-[var(--bg)] sm:text-base">
          <ImageIcon className="h-4 w-4" /> Choose Photo
        </button>
        <button onClick={() => onPick("live")} className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--line)] bg-[var(--surface)] px-2 py-3 text-sm font-medium hover:bg-[var(--bg)] sm:text-base">
          <VideoIcon className="h-4 w-4" /> Live Camera
        </button>
      </div>
    </div>
  );
}

function CardPreview({ label, src, onRotate, onRetake, onRemove }: { label: string; src: string; onRotate: () => void; onRetake: () => void; onRemove?: () => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
        <div className="flex gap-1">
          <IconBtn onClick={onRotate} label="Rotate">
            <RotateIcon className="h-4 w-4" />
          </IconBtn>
          <IconBtn onClick={onRetake} label="Retake">
            <CameraIcon className="h-4 w-4" />
          </IconBtn>
          {onRemove && (
            <IconBtn onClick={onRemove} label="Remove">
              <XIcon className="h-4 w-4" />
            </IconBtn>
          )}
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${label} of card`} className="max-h-72 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] object-contain" />
    </div>
  );
}

function Field({
  label, value, onChange, placeholder = "Blank if not on card", className = "", inputMode, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete} className="input" />
    </label>
  );
}

function MultiField({ label, values, onChange, type }: { label: string; values: string[]; onChange: (v: string[]) => void; type: "tel" | "email" }) {
  const list = values.length ? values : [""];
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="space-y-2">
        {list.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              type={type}
              value={v}
              aria-label={`${label} ${i + 1}`}
              onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="Blank if not on card"
              className="input"
            />
            {(list.length > 1 || label === "Office Phone") && (
              <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="rounded-lg px-2 text-[var(--muted)] hover:text-[var(--danger)]" aria-label={`Remove ${label} ${i + 1}`}>
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...list, ""])} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[var(--brand)]">
        <PlusIcon className="h-3.5 w-3.5" /> Add another
      </button>
    </div>
  );
}

function PrimaryBtn({ children, onClick, busy, disabled }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-3.5 font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:bg-[var(--bg)]">
      {children}
    </button>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--ink)]">
      {children}
    </button>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

function GoogleStatus({ on, onSignOut }: { on: boolean; onSignOut: () => void }) {
  if (!GOOGLE_CLIENT_ID)
    return (
      <p className="mt-3 text-xs text-[var(--muted)]">
        Google Contacts sync needs a Google Client ID (NEXT_PUBLIC_GOOGLE_CLIENT_ID). See README.
      </p>
    );
  return (
    <p className="mt-3 text-xs text-[var(--muted)]">
      {on ? (
        <>
          Connected to Google.{" "}
          <button onClick={onSignOut} className="underline">
            Disconnect
          </button>
        </>
      ) : (
        "You'll be asked to sign in with Google the first time."
      )}
    </p>
  );
}

function SavedList({
  contacts, onEdit, onDelete, onPhone, onGoogle, onScan, busy,
}: {
  contacts: Contact[]; onEdit: (c: Contact) => void; onDelete: (c: Contact) => void; onPhone: (c: Contact) => void;
  onGoogle: (c: Contact) => void; onScan: () => void; busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [event, setEvent] = useState("");
  const events = useMemo(() => Array.from(new Set(contacts.map((c) => c.event).filter(Boolean))).sort(), [contacts]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        (!event || c.event === event) &&
        (!s ||
          [c.name, c.company, c.designation, c.event, c.notes, ...c.emails, ...c.mobiles, ...c.phones]
            .join(" ")
            .toLowerCase()
            .includes(s)),
    );
  }, [contacts, q, event]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Saved Contacts</h1>
          <p className="mt-1 text-[var(--muted)]">{contacts.length} contact{contacts.length === 1 ? "" : "s"} scanned</p>
        </div>
        {contacts.length > 0 && (
          <div className="flex gap-2">
            <SmallBtn onClick={() => exportAllVCards(filtered)}>
              <DownloadIcon className="h-4 w-4" /> Export .vcf
            </SmallBtn>
            <SmallBtn onClick={() => downloadBlob(new Blob([toCSV(filtered)], { type: "text/csv;charset=utf-8" }), "cardkeep_contacts.csv")}>
              <DownloadIcon className="h-4 w-4" /> Export CSV
            </SmallBtn>
          </div>
        )}
      </div>

      {contacts.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
          <p className="text-[var(--muted)]">No contacts yet.</p>
          <button onClick={onScan} className="mt-4 rounded-xl bg-[var(--brand)] px-5 py-3 font-semibold text-white">
            Scan your first card
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, phone…" className="input pl-9" aria-label="Search contacts" />
            </label>
            {events.length > 0 && (
              <select value={event} onChange={(e) => setEvent(e.target.value)} className="input sm:w-56" aria-label="Filter by event">
                <option value="">All events</option>
                {events.map((ev) => (
                  <option key={ev}>{ev}</option>
                ))}
              </select>
            )}
          </div>

          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <li key={c.id} className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
                <div className="flex gap-3">
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt="" className="h-14 w-24 shrink-0 rounded-lg border border-[var(--line)] object-cover" />
                  ) : (
                    <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-lg font-bold text-[var(--brand)]">
                      {displayName(c).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{displayName(c)}</p>
                    <p className="truncate text-sm text-[var(--muted)]">{[c.designation, c.company].filter(Boolean).join(" · ")}</p>
                    {c.mobiles[0] && <p className="truncate text-sm">{c.mobiles[0]}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                  {c.event && <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 font-medium text-[var(--brand)]">{c.event}</span>}
                  <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  {c.googleResourceName && (
                    <a href={googleContactUrl(c.googleResourceName)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                      <GoogleIcon className="h-3.5 w-3.5" /> In Google
                    </a>
                  )}
                </div>
                <div className="mt-auto flex gap-1 border-t border-[var(--line)] pt-3">
                  <IconBtn onClick={() => !busy && onPhone(c)} label="Save to phone">
                    <DownloadIcon className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn onClick={() => !busy && onGoogle(c)} label={c.googleResourceName ? "Update in Google" : "Save to Google"}>
                    <GoogleIcon className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn onClick={() => onEdit(c)} label="Edit">
                    <EditIcon className="h-4 w-4" />
                  </IconBtn>
                  <span className="ml-auto" />
                  <IconBtn onClick={() => onDelete(c)} label="Delete">
                    <TrashIcon className="h-4 w-4" />
                  </IconBtn>
                </div>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p className="mt-8 text-center text-[var(--muted)]">No contacts match your search.</p>}
        </>
      )}
    </>
  );
}
