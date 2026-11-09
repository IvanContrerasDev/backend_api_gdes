/** Shared by boot validation and the adapter (also constructed directly in tests/tools). */
export function validateStorageEndpoints(config: {
  endpoint: unknown;
  publicEndpoint?: unknown;
  allowInsecureHttp?: unknown;
  nodeEnv?: string;
}): { endpoint: URL; publicEndpoint: URL } {
  const flag = config.allowInsecureHttp === undefined ? 'false' : config.allowInsecureHttp;
  if (flag !== 'true' && flag !== 'false') {
    throw new Error('STORAGE_ALLOW_INSECURE_HTTP must be the string true or false');
  }
  const development = config.nodeEnv === 'development' || config.nodeEnv === 'test';
  if (flag === 'true' && !development) {
    throw new Error('STORAGE_ALLOW_INSECURE_HTTP is only allowed in development/test');
  }
  function parse(value: unknown, name: string): URL {
    if (typeof value !== 'string' || !value) throw new Error(`Invalid ${name}`);
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const allowHttp =
      config.nodeEnv !== 'production' && (loopback || (development && flag === 'true'));
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp))
    ) {
      throw new Error(
        `${name} requires HTTPS without credentials, query or fragment; HTTP requires development/test opt-in (loopback excepted)`,
      );
    }
    return url;
  }
  const endpoint = parse(config.endpoint, 'STORAGE_ENDPOINT');
  return {
    endpoint,
    publicEndpoint:
      config.publicEndpoint === undefined
        ? endpoint
        : parse(config.publicEndpoint, 'STORAGE_PUBLIC_ENDPOINT'),
  };
}
