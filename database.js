/* Server-backed photo persistence shared by every visitor. */
(function () {
  function request(path, options = {}) {
    const baseUrl = window.CUTE_MEMORIES_API_BASE || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    const cacheMode = options.method && options.method !== 'GET' ? 'no-store' : 'no-cache';
    return fetch(`${baseUrl}${path}`, { ...options, cache: cacheMode, signal: controller.signal }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      return body;
    }).catch(error => {
      if (error.name === 'AbortError') throw new Error('The photo server did not respond. Check the shared API connection.');
      throw new Error(`Could not connect to the photo server: ${error.message}`);
    }).finally(() => clearTimeout(timeout));
  }

  window.MemoryDB = {
    async getAll() {
      const result = await request('/api/photos');
      return result.photos || [];
    },
    async put(photo) {
      let blob = photo.blob;
      if (!blob && photo.image) {
        blob = await fetch(photo.image).then(response => response.blob());
      }
      if (!blob) throw new Error('The photo file is missing.');
      const chunkSize = 8 * 1024 * 1024;
      const chunkCount = Math.ceil(blob.size / chunkSize);
      for (let index = 0; index < chunkCount; index++) {
        const chunk = blob.slice(index * chunkSize, (index + 1) * chunkSize);
        const form = new FormData();
        form.append('id', photo.id);
        form.append('index', String(index));
        form.append('chunkCount', String(chunkCount));
        form.append('chunk', chunk, `${photo.id}-${index}.bin`);
        await request('/api/photos/chunk', {
          method: 'PUT',
          body: form
        });
      }
      await request('/api/photos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complete: true,
          id: photo.id,
          chunkCount,
          type: blob.type || 'image/jpeg',
          title: photo.title || '',
          description: photo.description || '',
          album: photo.album || '',
          createdAt: photo.createdAt || new Date().toISOString()
        })
      });
      return photo;
    },
    async delete(id) {
      await request(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async clear() {
      await request('/api/photos', { method: 'DELETE' });
    }
  };

  window.MemoryStore = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        window.dispatchEvent(new CustomEvent('memory-storage-error', { detail: error }));
        return false;
      }
    },
    remove(key) {
      localStorage.removeItem(key);
    }
  };
})();
