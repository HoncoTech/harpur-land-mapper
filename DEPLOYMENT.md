
# Deployment notes

## Mobile access

The V4.3 UI has a mobile layout:
- map first
- plot details below
- touch-sized controls
- Google Maps pan/pinch zoom
- BhuNaksha PNG refresh after map movement settles

It works from a mobile browser once the app is deployed to a public HTTPS URL.

## GitHub

GitHub is excellent for storing/versioning the source code, but **GitHub Pages alone cannot run this app**, because the project needs:
- Node.js / Express
- server-side proxy calls to BhuNaksha
- SQLite database writes
- polygon reconstruction on the server

Recommended structure:

1. Push this folder to a GitHub repository.
2. Deploy the repository to a Node-capable hosting provider.
3. Attach persistent storage for the SQLite database, or later move the DB to hosted PostgreSQL.
4. Configure environment variables.

### Environment variables

`GOOGLE_MAPS_API_KEY`
- Optional.
- If set, the app automatically fills the key for users.
- Restrict the key in Google Cloud to your deployed website origin and the Maps JavaScript API.

`DB_PATH`
- Optional.
- Defaults to `./harpur.sqlite`.
- For hosting, point this to a persistent mounted disk, for example `/data/harpur.sqlite`.

Example:

```text
GOOGLE_MAPS_API_KEY=your_key
DB_PATH=/data/harpur.sqlite
```

## Why persistent storage matters

If your hosting platform uses an ephemeral filesystem, a local SQLite file can disappear after redeploy/restart. Use:
- a persistent disk/volume, or
- migrate to hosted PostgreSQL for a stronger family/shared deployment.

## Public/family access

Once deployed, your family only needs the HTTPS URL on:
- iPhone/iPad Safari
- Android Chrome
- desktop browsers

No Node/npm is needed on their devices.
