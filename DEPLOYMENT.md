## Harpur Land Mapper V7.1

Map-first Add Plot UI with dynamic CS/RS loading and ownership/land-type fields.

# Deployment — V6.0

## Render

Use:
- Runtime: Node
- Node version: 22.22.0
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `GOOGLE_MAPS_API_KEY`

The Saved Plots landing page does not call BhuNaksha, so family browsing is independent of BhuNaksha/WMS availability.

## SQLite on Render Free

The included `harpur.sqlite` is a seed database committed with the application.

Runtime edits can still be lost when a free Render instance is replaced/redeployed because its filesystem is ephemeral.

For permanent multi-user editing, later move to:
- paid persistent disk + SQLite, or
- hosted PostgreSQL.
