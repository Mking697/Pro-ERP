import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");
  const { organizations, users } = await import("../src/db/schema");

  const orgs = await db.select().from(organizations);
  console.log(`Organizations (${orgs.length}):`);
  for (const o of orgs) {
    console.log(`  - ${o.id} | ${o.orgName} | status=${o.status}`);
  }

  const allUsers = await db.select().from(users);
  console.log(`\nUsers (${allUsers.length}):`);
  for (const u of allUsers) {
    console.log(`  - ${u.id} | org=${u.orgId} | email=${u.email} | role=${u.role} | status=${u.status}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Inspect failed:", error);
    process.exit(1);
  });
