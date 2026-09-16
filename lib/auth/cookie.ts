/**
 * Shared between middleware.ts (Edge runtime) and the facilitator login
 * server action, so kept tiny and dependency-free — nothing here should
 * ever need anything beyond what Edge middleware can run.
 */
export const FACILITATOR_COOKIE_NAME = "facilitator_auth";
