window.ElectionAPI = {
  async json(url, { signal } = {}) {
    const relay = document.querySelector('meta[name="election-api"]').content === 'relay';
    const target = relay ? '/api/fetch?url=' + encodeURIComponent(url) : url;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 25000);
    try {
      const response = await fetch(target, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        // Finish the response before the next paginated request or rate-limit retry.
        await response.arrayBuffer();
        const error = new Error(
          response.status === 429
            ? 'The exchange rate limit was reached. Try again shortly.'
            : 'Exchange returned HTTP ' + response.status + '.',
        );
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  },
};
