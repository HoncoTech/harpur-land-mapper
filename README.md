# Harpur Land Mapper V6.1.1

## Fixes / improvements

### BBox visibility
The selected saved plot BBox is now rendered as a highly visible Google Maps Rectangle:
- bright red outline
- 5 px selected outline
- stronger transparent red fill
- high z-index
- selecting a plot fits the map to the BBox so the whole rectangle is visible

`Show all plot boxes` still shows the other filtered BBoxes with lighter outlines.

The BBox uses only SQLite `xmin`, `ymin`, `xmax`, `ymax`; it does not call BhuNaksha.

### Satellite labels
Both Saved Plots and Add Plot maps now default to Google Maps `hybrid` mode:
- satellite imagery
- roads/place labels overlaid

Important: the red rectangle is the BBox/envelope, not the exact legal parcel boundary.
