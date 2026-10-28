import { useEffect, useState } from "react";
import type { RoomTerms } from "./types";
import { idbGet, idbPut } from "./idb";

export const savePhoto = (id: string, blob: Blob) => idbPut("photos", id, blob);

export async function loadPhoto(id: string): Promise<Blob | null> {
  return (await idbGet<Blob>("photos", id)) ?? null;
}

/** Scales a photo down to 1600px on its long edge and re-encodes it, which also drops its metadata. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo"))), "image/jpeg", 0.86));
}

/** The address of a room's photo, or null while loading or when it has none. */
export function usePhoto(terms: Pick<RoomTerms, "id" | "photo"> | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!terms?.photo) return setUrl(null);
    if (terms.photo !== "local") return setUrl(terms.photo);
    let objectUrl: string | null = null;
    let live = true;
    loadPhoto(terms.id)
      .then((blob) => {
        if (!live || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [terms?.id, terms?.photo]);
  return url;
}
