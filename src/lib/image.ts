/** Load a File/Blob or data URL into an <img>. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open this image. Try a JPG or PNG photo."));
    img.src = src;
  });
}

export function fileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Resize to fit maxSize and re-encode as JPEG. Optional rotation in 90° steps. */
export async function processImage(src: string, maxSize = 1600, rotate = 0, quality = 0.85): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const r = ((rotate % 360) + 360) % 360;
  const canvas = document.createElement("canvas");
  canvas.width = r === 90 || r === 270 ? h : w;
  canvas.height = r === 90 || r === 270 ? w : h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function dataURLParts(dataURL: string) {
  const [meta, data] = dataURL.split(",");
  const mediaType = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
  return { mediaType, data };
}
