import { expect, it } from "vitest";
import config from "../next.config";
it("keeps the Neon Node driver external rather than inlining its protocol parser into the proxy", () => {
 expect(config.serverExternalPackages).toContain("@neondatabase/serverless");
});
