/* Server-backed photo persistence shared by every visitor. */
(function () {
  function request(path, options = {}) {
    const baseUrl = window.CUTE_MEMORIES_API_BASE || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    return fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      return body;
    }).catch(error => {
      if (error.name === 'AbortError') throw new Error('The photo server did not respond. Check the shared API connection.');
      throw new Error(`Could not connect to the photo server: ${error.message}`);
    }).finally(() => clearTimeout(timeout));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read the photo.'));
      reader.readAsDataURL(blob);
    });
  }

  window.MemoryDB = {
    async getAll() {
      const result = await request('/api/photos');
      return result.photos || [];
    },
    async put(photo) {
      const payload = { ...photo, image: photo.image || (photo.blob ? await blobToDataUrl(photo.blob) : '') };
      delete payload.blob;
      await request('/api/photos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
