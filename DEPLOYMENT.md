# Deployment - v7.10

Deploy the application the same way as v7.9 (GitHub → Render).

## Important

- Keep the included `harpur.sqlite` database.
- Authentication uses the pre-populated `vineet` ADMIN record and its salted PIN hash.
- Session inactivity timeout is 1 hour.
- Sessions are in memory, so a Render restart/redeploy requires signing in again.

## Validation after deployment

1. Sign in on desktop/tablet and confirm `vineet • Admin • Logout` appears at the top-right.
2. Sign in on phone/mobile and confirm Logout is inside the hamburger menu.
3. Confirm Logout returns to the PIN screen.
4. Confirm Family Plots / Add Family Plot remain protected after logout.
5. Confirm the saved-map helper text banner is no longer displayed.
