# Admin username/password login — 24 October 2026

The admin space now uses a username and password, as requested. Player login continues to require phone/OTP. This supersedes the previous back-office OTP login instructions.

Migration `005_admin_password_login.sql` creates the initial account:

- Username: `zoubai`
- Initial password: `123456`
- Role: `administrator`

The database stores a salted scrypt hash, never the plaintext password. The migration is versioned and runs once; rerunning migrations does not reset a changed password. It creates a separate staff identity without a fake telephone or player wallet. Existing player rows retain their phone requirement.

The initial credential is for local development and is rejected in production, including access/refresh sessions created with that credential before switching modes. In the admin space, open **compte** to replace it with a password of at least twelve characters. Changing the password revokes all previous admin sessions, issues a fresh session and removes the development-only restriction.

## Run

```powershell
# Local Node API
npm.cmd run migrate
npm.cmd start

# Separate terminal: back-office
npm.cmd run dev --prefix admin
```

For the existing Docker API, rebuild it so it includes the new login route:

```powershell
docker compose up --build -d
```

Open `http://127.0.0.1:5173`. The migration has already been applied and the Docker API rebuilt/restarted during this change; existing data and volumes were preserved. The rebuild command above is for subsequent source updates.

## API and boundaries

- `POST /v1/admin/auth/login`: `{username,password}`. Username matching is case insensitive. The server checks the current `administrator` role; moderator and missing-role accounts cannot log in with this endpoint.
- Access/refresh tokens use the existing hashed-token session infrastructure, with a separate `admin` audience. Refresh rotation preserves that audience. Role removal invalidates existing admin access and refresh tokens.
- `POST /v1/admin/auth/password`: admin Bearer plus `{currentPassword,newPassword}`; verifies the current password, updates the hash, revokes old sessions, returns a replacement session.
- `/auth/refresh` and `/auth/logout` retain their existing contracts.
- Password attempts are limited through Redis (five per username/minute and twenty per IP/minute); dependency failures do not bypass limits. Unknown accounts, wrong passwords, disallowed role and the development account in production return the same 401 message.
- Admin tokens may access administration and competition read views. They cannot create/join rooms, access player wallets, register/play competitions, change a player profile or authenticate on the player WebSocket.
- Passwords and session tokens are not logged, included in URLs, prefilled into the form or stored in browser storage. The UI uses password autocomplete fields, clears credentials after success and clears displayed admin results at logout.

## Validation

Executed successfully: `npm.cmd test` (18 tests), `node --env-file=.env scripts/test-services.js` (30 entries, native PostgreSQL and Redis), `npm.cmd run build --prefix admin` (TypeScript and Vite).

`node test/browser/admin-login.mjs` also passed in headless Microsoft Edge: username/password fields (no OTP), masked password, Enter-to-submit, admin page access, audit display and cleared data after logout. The browser scenario mocks API responses; the native HTTP integration scenario above exercises the real password authentication and database.

Live Docker API check also succeeded after rebuilding: the initial account authenticated with the administrator role, read the admin audit, was denied access to the player wallet (403), and its verification session was logged out. No session token was printed and the initial password was not changed on the local account.

The added HTTP scenario verifies the migrated credential, hash storage, wrong and unknown credentials, administrator role enforcement and revocation, admin/player isolation, production rejection of the default, session rotation, password change, old-session revocation, preservation of changed credentials when migrations rerun, production login after password change, and rate limiting. Test password changes happen only in an isolated test schema, not in the local seeded account.
