# Harpur Land Mapper v7.5

Map-first family land-mapping application using Google Hybrid and Bihar BhuNaksha.

## v7.5 highlights

### v7.5 geometry/display refinements
- Selected Plot card now has a Close (×) action that clears only the selected pin/temporary geometry and keeps the active survey map, sheet, zoom and pan.
- Family Plots map has independent Parcel Shape, BBox and Pins layers; all three default ON.
- Valid irregular parcel geometry and its BBox can be shown together.
- Geometry reconstruction now uses a tighter percentage-based parcel render, higher raster detail, anti-alias filtering, one-pixel inner-mask erosion, and lighter contour simplification.
- Geometry version is now 3; invalid reconstruction still falls back to the saved BBox.

- Add Family Plot opens as a full survey-map workspace on desktop and mobile.
- Mauza → Survey → Map Instance → Sheet loads dynamically and automatically selects the first available live option.
- Supports CS and RS through one shared map engine.
- Parcel click shows a confirmation card before opening the details form.
- Responsive desktop side panel and mobile bottom-sheet style details experience.
- Added `land_type` to plot data: Agriculture Land, Dih / Village Land, or Other.
- Ownership UX supports Individual (one owner) and Joint (multi-owner selection).
- Exact Raiyat Name remains separate from normalized family-member ownership.
- Added family/reference picker data and local location picker.
- Existing Family Plots map remains unchanged.

## Important
BhuNaksha overlays and reconstructed parcel geometry are for family reference and visual matching, not an official legal survey.


## V7.2 — Parcel shapes & map measurements

- Add Family Plot automatically traces the selected BhuNaksha `PLOT_LIST` raster into an irregular polygon when possible.
- Map-derived measurements are calculated from the reconstructed polygon: square meters, Decimal, Bigha (62 Decimal/Bigha), perimeter, longest dimension and approximate width.
- Family Plots renders the stored irregular parcel polygon when available and safely falls back to the existing BBox.
- Legacy saved plots are lazily upgraded: selecting a plot attempts one reconstruction and stores the result for reuse.
- The existing Boxes control remains available; it now shows parcel shapes where available and BBoxes otherwise.
- Official land-record area remains separate from map-calculated area.
- Plot Identity stays permanently open in Add Family Plot; other sections use a controlled accordion (desktop max 2, mobile max 1).

## v7.5 geometry refresh workflow
- Existing family plots are refreshed deliberately from the visible Add Family Plot survey map.
- Selecting an already-saved parcel loads its saved family/land-record information for update.
- Fresh BhuNaksha `PLOT_LIST` geometry is accepted only after validation against the parcel BBox.
- Family Plots never reconstruct geometry in the background: valid irregular geometry is shown when stored; otherwise the existing BBox remains visible.
- Selecting a pin no longer replaces a reliable BBox with invalid/tiny geometry.
- Family Plots is scoped to exactly one survey at a time (RS or CS), with no All-surveys mode.


## Version 7.5
- Saved Plot details now mirrors Add Family Plot fields and ownership controls.
- Plot Identity stays open; desktop allows two additional sections and mobile one.
- Existing geometry/map technical data remains read-only in the technical section.


## Version 7.6 review fixes
- Existing plot matching now uses Survey + Plot No.
- View Saved Plot preserves the active Add Plot survey and focuses the saved row/map parcel.
- Add Plot selection card closes when clicking outside; Choose Another was removed.
- Plot Identity stays open and only one additional Add Plot section may be open.
- Desktop/mobile resize now re-evaluates the mobile Saved Plots toolbar.
- Add Plot detail header spacing was reduced to improve vertical space.


## v7.7 reconstruction fallback fix

Parcel-shape reconstruction is now non-fatal. If BhuNaksha parcel tracing cannot produce a valid irregular polygon, `/api/reconstruct` returns an `INVALID` geometry warning instead of a 502 error. Add/Update continues using the parcel BBox fallback. A previously valid saved polygon is preserved when a new reconstruction attempt fails. The manual Reconstruct action reports the warning in the page status instead of blocking the workflow with an alert.


## v7.8 robust parcel contour fix

- Replaced the fragile greedy boundary-pixel walker with a pixel-cell outer-contour tracer.
- Tries both the raw parcel mask and a one-pixel eroded alternative, validates both, and keeps the better candidate.
- Preserves the v7.7 non-blocking BBox fallback if neither contour is valid.
- Geometry version is now 4 for newly reconstructed shapes.
- This specifically targets repeatable failures such as RS Plot 525 returning `Could not trace selected plot boundary`.
