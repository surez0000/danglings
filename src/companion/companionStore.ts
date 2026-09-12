import { COMPANION_BY_ID, COMPANION_STORAGE_KEY, type CompanionId, type CompanionSelection } from "./types";

export function loadCompanion(): CompanionSelection {
  try {
    const saved = localStorage.getItem(COMPANION_STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        const kind = (parsed as { kind?: unknown }).kind;
        const id = (parsed as { id?: unknown }).id;
        // Legacy shape from the bird-only build.
        if (kind === "bird") return { kind: "companion", id: "bluebird" };
        if (kind === "companion" && typeof id === "string" && id in COMPANION_BY_ID) {
          const def = COMPANION_BY_ID[id as CompanionId];
          const variantId = (parsed as { variantId?: unknown }).variantId;
          const valid =
            typeof variantId === "string" && def.variants?.some((v) => v.id === variantId)
              ? variantId
              : undefined;
          return { kind: "companion", id: id as CompanionId, variantId: valid };
        }
        if (kind === "charm") return { kind: "charm" };
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return { kind: "charm" };
}

export function saveCompanion(c: CompanionSelection): void {
  localStorage.setItem(COMPANION_STORAGE_KEY, JSON.stringify(c));
}
