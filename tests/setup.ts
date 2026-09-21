import { config } from "dotenv";

// Same convention as scripts/*-live-test.ts — DATABASE_URL and friends come from
// .env.local locally, or from the environment directly in CI.
config({ path: ".env.local" });
