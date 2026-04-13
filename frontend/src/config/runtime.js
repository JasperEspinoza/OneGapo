function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/$/, '');
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

export function resolveApiUrl(input) {
  if (typeof input !== 'string') return input;
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return input;

  if (input.startsWith('/api/')) {
    return `${baseUrl}${input}`;
  }

  try {
    const parsed = new URL(input);
    if (parsed.pathname.startsWith('/api/')) {
      return `${baseUrl}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return input;
  }

  return input;
}

export function getSocketServerUrl() {
  const socketUrl = normalizeBaseUrl(import.meta.env.VITE_SOCKET_URL);
  if (socketUrl) return socketUrl;

  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl || undefined;
}
