import type * as sdk from '@neondatabase/serverless';
export interface Credentials { label: string; connectionString: string; names: { pg: string; ws: string; internal: string; ingress: string } }
export const root: string;
export const label: string;
export function loadCredentials(): Credentials;
export function configureSDK(module: typeof sdk, credentials: Credentials): void;
export function verifyPool(pool: sdk.Pool): Promise<{ database: string; username: string }>;
