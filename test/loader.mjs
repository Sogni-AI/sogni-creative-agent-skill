const STUB_URL = new URL('./sogni-client-stub.mjs', import.meta.url);

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === '@sogni-ai/sogni-intelligence-client' || specifier === '@sogni-ai/sogni-client-wrapper') {
    return {
      url: STUB_URL.href,
      shortCircuit: true
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
