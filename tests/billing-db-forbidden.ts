// DB-free billing config resolves all production DB imports here. Never reads env.
export const db = new Proxy({}, { get() { throw new Error("Database access forbidden in billing unit tests"); } });
export async function runInTenantTransaction(): Promise<never> { throw new Error("Database access forbidden in billing unit tests"); }
