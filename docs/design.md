# Design

The visual language of the FreePL web app. Specs 0002–0006 say **what** each screen does;
this file says **how it looks**. When the look changes, change this file in the same
commit.

Clickable reference: [`docs/design/mockup.html`](design/mockup.html) — open it in a
browser. Synthetic players and Clubs only; a design reference, not production code.

## Principles

- **Phone first, 390px.** Every screen is designed at phone width and must work one-handed.
  Density is the product: tables, not cards, wherever a table fits.
- **Never colour alone.** Every colour that carries meaning also carries a word or label:
  band word next to a row colour, opponent and H/A inside a fixture colour, "Blank" in a
  blank cell, % or OUT on a flag.
- **Two scales that never mix.** Fixture difficulty runs green → red. Pick rating runs
  blue → teal → plain (with red only for Below OK, Squad and Players only). A hard fixture
  must never read as a bad pick.
- **Show the state, not a spinner.** Freshness line on every data screen; stale data is
  amber/red, never silently hidden.
- **What-if is visibly what-if.** Planned transfers and lineups are labelled as plans and
  never look like the real FPL state.

## Colour tokens

Light values; dark values in the mockup's `:root` blocks. Defined once as CSS custom
properties and switched by `prefers-color-scheme` and an explicit `data-theme`.

| Token | Light | Use |
| --- | --- | --- |
| `--bg` / `--surface` | `#eef2ef` / `#ffffff` | Page / cards, tables, sheets. Neutrals lean slightly green |
| `--ink` / `--muted` / `--line` | `#16211c` / `#5d6b64` / `#d5ddd8` | Text / secondary text / borders |
| `--accent` | `#2a55c7` | Links, selected tab underline, focus, move prompt |
| `--warn`, `--warn-bg` | `#9a5b00`, `#fff1d6` | Doubtful players, amber freshness |
| `--bad`, `--bad-bg` | `#b3261e`, `#fde4e1` | Ruled out, red freshness, invalid plans |
| `--band-best` | `#2f5f9e` muted steel blue | Best |
| `--band-great` / `--band-good` | `#2b8a80` / `#7fc0b5` teal | Great / Good |
| `--band-ok` | `#d4ebe6` | OK (legend chip; rows get only a grey stripe) |
| `--band-low` | `#b5544a` muted red | Below OK (Squad and Players only) |
| `--fdr1`…`--fdr5` | `#1e7a4a` `#7cc49a` `#dfe3e1` `#e9877c` `#a3241c` | Fixture difficulty 1 (easy) → 5 (hard) |
| `--pitch` / `--pitch-line` / `--bench` | `#3d7a57` / white 28% / `#d9e3dd` | Turf / pitch markings / bench strip |

Band colours share saturation and lightness so the ladder reads evenly; Best is
distinguished by hue (blue), not by being louder.

## Type

- **Barlow Condensed** (600–700) for headings, tab labels, big numbers.
- **Barlow** (400–600) for everything else.
- Numbers use `tabular-nums` wherever they line up.
- Prices always render from integer tenths: `75` → `£7.5m`.

## Components

**Tab bar.** Text tabs with a 3px accent underline on the selected one. Order: My squad,
Picks, Players, Fixtures, Injury watch (count badge in red).

**Freshness line.** Dot + "Data as of …, n hours ago"; green / amber / red per the contract
thresholds.

**Rating rows (Picks, Squad list).** Whole-row tint plus a 6px left stripe in the band
colour; band word on the player's second line ("Great · KST · £6.5m"). Best/Great/Good
tinted; OK plain with a grey stripe; Below OK muted red tint; Not rated plain with a dashed
grey stripe and the reason.

**Fixture cell.** Small rounded chip, opponent short name + H/A, filled with `--fdr{n}`.
Doubles stack two chips in one cell; blanks are a dashed "Blank" chip, never an empty cell.
A provisional fixture (kick-off not confirmed) keeps its fill but gets a dotted border and a
small "TBC", so it reads without colour; it still fits stacked in a double.

**Fixtures grid.** Club pinned left; then a narrow "Avg" column, also pinned, with the fixture count
under it ("2.4 / 6 fx"); then one column per gameweek, headed "GW9" with the deadline day
underneath ("Sat 25", local time), scrolling sideways. Cells are fixture cells as above.
Cells are not tappable in v1.

**Player cell.** Line 1: name, then flags (amber "75%", red "INJ"/"SUS"/"OUT") and tags
("In squad", "C", "V", "Bench 1", "Planned"). Line 2: band word · Club · price. Pinned left
in wide tables.

**My squad — view bar.** Two connected rectangles, "Pitch | List", full width, joined with
no gap and no pill ends; only the outer top corners are rounded. Selected = dashboard
green with light text; unselected = surface. Sits flush on top of the dashboard strip.

**My squad — dashboard strip.** One compact dark-green band (pitch green darkened), not
separate cards. Row 1: Bank, Free transfers, Selling value, Squad value — small uppercase
label, 17px number, one-word note ("now", "live", "FPL · GW8"). Row 2: chips of the current
set, used ones struck through, and the expiry. In Pitch view it joins the pitch below it
into one panel; in List view it stands alone.

**My squad — needs-attention line.** Above everything: "Needs attention:" then tappable
rounded chips (amber/red background) per flagged player, per blank, and "No captain set".
Green "Nothing needs attention" when clear.

**Pitch.** Darker "stands" background; the turf is a separate layer drawn in perspective
(tilted back ~26°, narrower at the far end) with horizontal mown stripes, halfway line,
centre circle, penalty box, six-yard box, arc, and a goal with a net at the top. Players
are *not* tilted: they sit upright and flat on top so they stay legible and tappable.
Rows: GK, DEF, MID, FWD; bench in its own light strip below, labelled with order.

**Shirt card.** A small Club shirt (34px, body + trim colour from the contract's colour
table; goalkeepers in a separate keeper kit; grey if a Club is missing) above a ~66px card:
4px band strip, short name, band word, next fixture chip(s), sell price. C/V badge on the
shirt's top right (dark circle), flags top left, "NEW" for planned players. While moving:
eligible cards get a white outline, the moving card a dashed outline, the rest dim.

**Bottom sheets.** Player sheet, rating breakdown and replacement list all slide up from
the bottom over a dimmed page; Escape or tapping outside closes them. The player sheet has
eight stat tiles (4×2), the next 3 fixtures, Captain / Vice-captain tick boxes, and
"Move" (outline) beside "Replace" (filled) as equal-width buttons.

**Rating breakdown.** One row per input: label with its weight, a bar (longer = better),
and an ordinal rank ("3rd").

**Legends.** Each screen that uses colour shows a one-line legend of the chips it uses.
