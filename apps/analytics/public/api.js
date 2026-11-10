// Fetch wrapper. With ?mock=1 in the page URL, calls are answered by mock.js from in-memory data.
const useMock = new URLSearchParams(location.search).has('mock');
export const isMock = useMock;
let mockP;

export async function api(method, path, body) {
  if (useMock) {
    mockP ??= import('./mock.js');
    return (await mockP).handle(method, path, body);
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Check that it is running, then try again.');
  }
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.error || j.message || ''; if (typeof msg !== 'string') msg = JSON.stringify(msg); } catch { /* not JSON */ }
    throw new Error(msg || `The server answered ${res.status}.`);
  }
  try { return await res.json(); } catch { throw new Error('The server sent an unreadable answer.'); }
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
