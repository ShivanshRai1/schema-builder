import type { WorkspaceFile } from "./workspaceFile";
import { parseProjectPayload } from "./workspaceFile";

const SHARE_PREFIX = "#share=";
/** Soft limit — beyond this, suggest file export instead of a URL. */
export const SHARE_URL_SOFT_LIMIT = 90_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSharePayload(ws: WorkspaceFile): string {
  const json = JSON.stringify(ws);
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64Url(bytes);
}

export function decodeSharePayload(encoded: string): WorkspaceFile {
  const bytes = base64UrlToBytes(encoded);
  const json = new TextDecoder().decode(bytes);
  return parseProjectPayload(JSON.parse(json));
}

export function buildShareUrl(ws: WorkspaceFile, origin = window.location.origin + window.location.pathname): {
  url: string;
  tooLarge: boolean;
} {
  const encoded = encodeSharePayload(ws);
  const url = `${origin}${SHARE_PREFIX}${encoded}`;
  return { url, tooLarge: url.length > SHARE_URL_SOFT_LIMIT };
}

export function tryParseShareFromLocation(hash = window.location.hash): WorkspaceFile | null {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    return decodeSharePayload(hash.slice(SHARE_PREFIX.length));
  } catch {
    return null;
  }
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
