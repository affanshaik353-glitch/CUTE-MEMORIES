/* Server-backed photo persistence shared by every visitor. */
(function () {
  function request(path, options = {}) {
    const baseUrl = window.CUTE_MEMORIES_API_BASE || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    return fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal }).then(async response => {
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
      const form = new FormData();
      form.append('id', photo.id);
      form.append('title', photo.title || '');
      form.append('description', photo.description || '');
      form.append('album', photo.album || '');
      form.append('createdAt', photo.createdAt || new Date().toISOString());
      form.append('photo', blob, `${photo.id}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
      await request('/api/photos', {
        method: 'PUT',
        body: form
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
