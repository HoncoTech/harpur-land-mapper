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
