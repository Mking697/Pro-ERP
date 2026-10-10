function validateEnvironment(env = process.env) {
  if (env.PRO_ERP_LOCAL_TESTS !== '1') throw new Error('Explicit PRO_ERP_LOCAL_TESTS=1 required; no dotenv fallback');
  if (!env.PRO_ERP_LOCAL_CREDENTIALS) throw new Error('Explicit PRO_ERP_LOCAL_CREDENTIALS scratch file required');
  return env.PRO_ERP_LOCAL_CREDENTIALS;
}
function validateConnection(value, expected) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid disposable connection'); }
  const options = [...url.searchParams];
  const allowedOptions = options.every(([key, val]) => key === 'sslmode' ? val === 'disable' : key === 'application_name' && /^pkg:npm\/%40neondatabase\/serverless@\d+\.\d+\.\d+$/.test(val));
  const uniqueOptions = new Set(options.map(([key]) => key)).size === options.length;
  const expectedURL = expected === undefined ? undefined : new URL(expected);
  const sameTarget = !expectedURL || ['protocol', 'hostname', 'port', 'pathname', 'username', 'password'].every(key => url[key] === expectedURL[key]);
  if (url.protocol !== 'postgresql:' || url.hostname !== 'pro-erp-regression-pg' || url.port !== '5432' || url.pathname !== '/pro_erp_test' || decodeURIComponent(url.username) !== 'pro_erp_test' || (!url.password && (!expectedURL || expectedURL.password)) || url.hash || url.searchParams.get('sslmode') !== 'disable' || !allowedOptions || !uniqueOptions || !sameTarget) {
    throw new Error('Only the exact disposable connection is permitted');
  }
  return url;
}
module.exports = { validateEnvironment, validateConnection };
