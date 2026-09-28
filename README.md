# Harpur Land Mapper — Version 5.5

## Version 5.5

This release consolidates the working cadastral-map workflow and the agreed selection-pin lifecycle.

### Pin lifecycle

- App/browser load → no pin
- Click a parcel → pin appears at the exact clicked location
- Plot lookup succeeds → pin label becomes the plot number
- Pan / zoom / cadastral PNG refresh → pin remains
- Save / Update → pin remains
- Click another parcel → old pin is removed and new pin appears
- Select saved plot → pin moves to the saved plot center
- Delete → pin is removed and selection is cleared

### Plot database operations

- **Save / Update Plot** creates or updates the record.
- **Delete Plot** asks for confirmation, then removes only the local application record.
- BhuNaksha itself is never modified.

### About page

Open:

```text
http://localhost:3000/about.html
```

The About page shows the application version, target cadastral area, major features and usage disclaimer.

### Other features

- Google Satellite map
- dynamic BhuNaksha PNG refresh after pan/zoom
- plot lookup through BhuNaksha
- owner / family, local name and notes
- Google Maps center link
- GeoJSON polygon reconstruction
- SQLite persistence
- mobile / tablet / desktop layout
- deployment environment variables

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```
# harpur-land-mapper
