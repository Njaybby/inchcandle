import wordmarkOnLight from "../assets/wordmark-on-light.svg";
import { makeQr, quietZone } from "./qr";

const font = '"Instrument Sans Variable", "Instrument Sans", system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Draws the bid card as a 1080 by 1350 image: the request, what it is for, and the wordmark. */
export async function bidCardImage(uri: string, title: string, note: string): Promise<Blob> {
  await Promise.all([document.fonts.load(`500 40px ${font}`), document.fonts.load(`400 32px ${font}`)]);
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f5f5f4";
  ctx.fillRect(0, 0, width, height);

  const code = makeQr(uri);
  const cell = Math.floor(880 / (code.size + quietZone * 2));
  const side = cell * (code.size + quietZone * 2);
  const left = Math.round((width - side) / 2);
  const top = 72;
  ctx.fillStyle = "#0b0b0c";
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) if (code.dark(r, c)) ctx.fillRect(left + (c + quietZone) * cell, top + (r + quietZone) * cell, cell, cell);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#0b0b0c";
  ctx.font = `500 44px ${font}`;
  ctx.fillText(fit(ctx, title, 960), width / 2, top + side + 92);
  ctx.fillStyle = "#4d4d4e";
  ctx.font = `400 32px ${font}`;
  ctx.fillText(fit(ctx, note, 960), width / 2, top + side + 146);

  const mark = await loadImage(wordmarkOnLight);
  const markHeight = 34;
  const markWidth = (mark.naturalWidth / mark.naturalHeight) * markHeight;
  ctx.drawImage(mark, (width - markWidth) / 2, height - 72 - markHeight, markWidth, markHeight);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the card"))), "image/png"));
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Hands a file to the share sheet where there is one, so a phone can save it to Photos; otherwise downloads it. */
export async function saveFile(blob: Blob, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

/** A calendar entry for the moment a room opens. */
export function calendarFile(title: string, start: number, url: string): Blob {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escape = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Inchcandle//Room//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@inchcandle`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + 15 * 60_000)}`,
    `SUMMARY:${escape(title)}`,
    `URL:${url}`,
    `DESCRIPTION:${escape(`The bids open. ${url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return new Blob([lines.join("\r\n")], { type: "text/calendar" });
}
