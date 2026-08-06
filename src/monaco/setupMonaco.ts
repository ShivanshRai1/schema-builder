import { loader } from "@monaco-editor/react";
import { spiceLanguageId, spiceTokensProvider } from "./spiceLanguage";

let configured = false;

/**
 * Self-host Monaco from /monaco/vs (copied from monaco-editor package)
 * and register a real SPICE language. Safe to call once at app startup.
 */
export function setupMonaco() {
  if (configured) return;
  configured = true;

  const base = import.meta.env.BASE_URL || "./";
  loader.config({
    paths: { vs: `${base}monaco/vs` },
  });

  loader.init().then((monaco) => {
    if (!monaco.languages.getLanguages().some((l) => l.id === spiceLanguageId)) {
      monaco.languages.register({ id: spiceLanguageId });
      monaco.languages.setMonarchTokensProvider(spiceLanguageId, spiceTokensProvider as never);
    }
  }).catch(() => {
    // Assets may be missing until `npm run copy-monaco`; editor can still mount later.
  });
}
