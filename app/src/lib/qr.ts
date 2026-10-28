import qrcode from "qrcode-generator";

export interface QrCode {
  /** Modules per side, without the quiet zone. */
  size: number;
  dark: (row: number, col: number) => boolean;
}

/** Low error correction keeps long payment requests scannable from a screen. */
export function makeQr(text: string): QrCode {
  const q = qrcode(0, "L");
  q.addData(text, "Byte");
  q.make();
  return { size: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
}

export const quietZone = 4;

/** One SVG path for every dark module, offset by the quiet zone. */
export function qrPath(code: QrCode): string {
  let d = "";
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) if (code.dark(r, c)) d += `M${c + quietZone} ${r + quietZone}h1v1h-1z`;
  }
  return d;
}
