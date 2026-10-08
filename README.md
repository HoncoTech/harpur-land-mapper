# Harpur Land Mapper v7.9

Map-first family land mapper for Harpur with CS/RS survey workflows.

## v7.9 changes

- Fixed pre-populated ADMIN user: `vineet`.
- PIN sign-in on phone, iPad/tablet, and desktop. The database stores only a salted one-way scrypt hash; the plain PIN is not stored in source or SQLite.
- Authentication uses an HttpOnly SameSite session cookie.
- Family Plots left panel is collapsible on iPad/tablet and desktop (>= 768 px).
- When collapsed, the map expands and a hamburger control reopens the panel without clearing survey, filters, selection, or map position.
- Family Plots header/search/filter/display controls stay fixed; only the plot list scrolls.
- Phone Saved Plots behavior remains unchanged.
- Uses the supplied rebuilt database with 52 CS and 48 RS records.

## Run

```bash
npm install
npm start
```

Set `GOOGLE_MAPS_API_KEY` in the deployment environment when available.
