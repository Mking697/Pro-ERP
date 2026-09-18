import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// dotenv's default `import "dotenv/config"` only loads `.env` — this project keeps its
// local secrets in `.env.local` (Next.js convention, already covered by .gitignore).
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL environment variable — set it in .env.local (a pooled Neon Postgres connection string)."
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
  verbose: true,
});
