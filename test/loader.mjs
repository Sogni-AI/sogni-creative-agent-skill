const STUB_URL = new URL('./sogni-client-stub.mjs', import.meta.url);
const SSRF_STUB_URL = new URL('./ssrf-guard-stub.mjs', import.meta.url);
const CLI_URL = new URL('../sogni-agent.mjs', import.meta.url);

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === '@sogni-ai/sogni-intelligence-client') {
    return {
      url: STUB_URL.href,
      shortCircuit: true
    };
  }
  if (specifier === './ssrf-guard.mjs' && context.parentURL === CLI_URL.href) {
    return {
      url: SSRF_STUB_URL.href,
      shortCircuit: true
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
