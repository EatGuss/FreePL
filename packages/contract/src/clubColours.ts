/**
 * Club shirt colours for the pitch view (spec 0004 "Shirt colours"): body and trim, keyed by
 * FPL's Club short name. Hand-kept — FPL's API has no colours and the app never loads FPL's
 * kit images. Supplied by the owner for 2026/27 (2026-10-28); re-check each summer for
 * promoted Clubs. A Club missing here gets the neutral kit, never an error.
 */
export interface ShirtColours { body: string; trim: string }

export const CLUB_COLOURS: Record<string, ShirtColours> = {
  MCI: { body: "#6CABDD", trim: "#1C2C5B" }, // pale sky blue, midnight navy
  ARS: { body: "#EF0107", trim: "#FFFFFF" }, // Arsenal red, white
  BHA: { body: "#0057B8", trim: "#FFFFFF" }, // bright blue, white
  LIV: { body: "#C8102E", trim: "#00A398" }, // gym red, deep teal
  CHE: { body: "#034694", trim: "#C0C0C0" }, // Rush blue, chrome silver
  BRE: { body: "#E30613", trim: "#FFFFFF" }, // true red, white
  LEE: { body: "#FFFFFF", trim: "#FFCD00" }, // pure white, bright yellow
  NEW: { body: "#241F20", trim: "#FFFFFF" }, // black, white (placeholder: owner to confirm)
  AVL: { body: "#670E36", trim: "#95BFE5" }, // deep claret, sky blue
  HUL: { body: "#F5A12D", trim: "#000000" }, // amber gold, pitch black
  EVE: { body: "#003399", trim: "#FFFFFF" }, // Sheffield blue, white
  IPS: { body: "#0047AB", trim: "#FFFFFF" }, // cobalt blue, white
  BOU: { body: "#DA291C", trim: "#000000" }, // vivid red, pitch black
  TOT: { body: "#FFFFFF", trim: "#132257" }, // lilywhite, binary blue
  FUL: { body: "#FFFFFF", trim: "#000000" }, // stark white, dark black
  MUN: { body: "#DA291C", trim: "#FFFFFF" }, // real red, white
  CRY: { body: "#C4122E", trim: "#1B458F" }, // crimson red, royal blue
  NFO: { body: "#DD0000", trim: "#0B5D2E" }, // Garibaldi red, forest green
  COV: { body: "#87CEEB", trim: "#111111" }, // light sky blue, jet black
  SUN: { body: "#EB172B", trim: "#FFFFFF" }, // scarlet red, white
};

/** The design's neutral kit, for a Club not in the table. */
export const NEUTRAL_SHIRT: ShirtColours = { body: "#C9D1CD", trim: "#59645F" };
/** Goalkeepers wear a distinct keeper kit whatever their Club. */
export const KEEPER_SHIRT: ShirtColours = { body: "#E2B53A", trim: "#6B5310" };

export function shirtFor(clubShort: string | undefined, keeper: boolean): ShirtColours {
  if (keeper) return KEEPER_SHIRT;
  return (clubShort && CLUB_COLOURS[clubShort]) || NEUTRAL_SHIRT;
}
