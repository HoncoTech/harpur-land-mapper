# Deployment - v7.9

1. Deploy the full application directory.
2. Keep `harpur.sqlite` from this package; it contains the rebuilt CS/RS data and the pre-populated hashed ADMIN credential.
3. Set `GOOGLE_MAPS_API_KEY` in the environment.
4. Start with `npm start`.

The PIN itself is not stored in source or SQLite. Login sessions are server-memory sessions and will require sign-in again after a server restart/redeploy.
