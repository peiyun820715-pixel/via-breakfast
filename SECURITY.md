# Security Review

Reviewed: 2026-08-05

## Scope

This is a GitHub Pages static site. It has no server, authentication, database, API routes, Supabase integration, OpenAI integration, cookies, or third-party runtime scripts.

## Security controls

- A restrictive Content Security Policy blocks external scripts, network connections and plugins.
- Imported JSON is limited to 1 MB, parsed as data only, schema-sanitized, length-limited and rendered with HTML escaping.
- Local state is normalized before loading, importing and saving. Imported prototype-pollution keys are rejected.
- Images are never uploaded or persisted. Only JPG, PNG and WebP files up to 2 MB are accepted for this-session confirmation.
- The user can export data and clear all locally stored data from the interface.

## Remaining privacy consideration

Breakfast preferences, allergies, dietary restrictions and history are stored in the browser's Local Storage in plain text so the static app can function offline. They are not transmitted by this application, but anyone with access to the same browser profile may read them. Do not use a shared device for sensitive health information; use **清除本機資料** when needed.

## Deployment note

GitHub Pages is public by design. Never commit real user exports, API keys, private images, `.env` files, credentials or production data to this repository.
