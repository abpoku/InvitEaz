// Kept in its own module (no server imports) so the "use client" login page can import it
// without pulling `@/lib/models/users` → `@/lib/db` (pg) into the client bundle.
export const AUTH_SERVICE_UNAVAILABLE = "AuthServiceUnavailable";
