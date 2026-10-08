# Harpur Land Mapper v7.10

Map-first Harpur family land mapper with RS/CS survey support, BhuNaksha parcel reconstruction, saved family plots, and fixed admin PIN authentication.

## v7.10 changes

- Session idle timeout changed to **1 hour**.
- Added **Logout** for tablet/desktop in the top-right header.
- Added **Logout** for phone/mobile inside the hamburger menu.
- Logout invalidates the server session and returns to the PIN sign-in screen.
- Expired authenticated API sessions return the user to sign-in with an expiry message.
- Removed the saved-map helper banner: `Satellite + labels • Saved pins • Irregular parcel shape when available • BBox fallback`.
- Keeps the v7.9 tablet/desktop collapsible Family Plots sidebar and fixed controls / scrolling plot-list layout.

## Authentication

- Fixed user: `vineet`
- Role: `ADMIN`
- PIN is verified against the pre-populated salted scrypt hash in SQLite.
- The plain PIN is not stored in the application source or SQLite.
- Sessions are stored in server memory and expire after 1 hour of inactivity. A server restart/redeploy also ends active sessions.

## Data

The package preserves the pre-populated RS/CS SQLite database from v7.9.
