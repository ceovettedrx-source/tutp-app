// TUT-66: the YouTube API on an e2e preview (E2E_REPLAY=1 only, never production). Deterministic,
// no network, no quota. A lesson whose query contains "quotatest" gets the 403 quotaExceeded answer.
export async function mockYoutubeFetch(url) {
  const u = new URL(url);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (u.pathname.endsWith('/search')) {
    if (/quotatest/i.test(u.searchParams.get('q') || '')) return json(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
    const code = u.searchParams.get('relevanceLanguage') || 'en';
    return json(200, { items: Array.from({ length: 6 }, (_, i) => ({
      id: { videoId: `mock${code}${i}abcde` },
      snippet: { title: `Mock lesson video ${code} ${i}`, channelTitle: 'Mock Channel', thumbnails: { medium: { url: '/images/video-placeholder.svg' } } },
    })) });
  }
  const ids = (u.searchParams.get('id') || '').split(',').filter(Boolean);
  return json(200, { items: ids.map((id, i) => ({ id, contentDetails: { duration: 'PT6M' }, statistics: { viewCount: String(1000 + i) } })) });
}
