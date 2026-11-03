/* Browser adapter for the shared Cute Memories API. */
(function () {
  const baseUrl = window.CUTE_MEMORIES_API_BASE || '';

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem('cuteMemoriesApiToken');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  const localDB = (() => {
    const DB_NAME = 'CuteMemoriesLocal';
    let connection;
    function open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
        request.onsuccess = () => { connection = request.result; resolve(connection); };
        request.onerror = () => reject(request.error);
      });
    }
    async function store(mode, action) {
      const db = connection || await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('photos', mode);
        const result = action(transaction.objectStore('photos'));
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      });
    }
    return {
      getAll: () => store('readonly', objectStore => objectStore.getAll()),
      put: photo => store('readwrite', objectStore => objectStore.put(photo)).then(() => photo),
      delete: id => store('readwrite', objectStore => objectStore.delete(id)),
      clear: () => store('readwrite', objectStore => objectStore.clear())
    };
  })();

  window.MemoryDB = {
    getAll: async () => {
      try {
        const result = await request('/api/photos');
        window.cuteMemoriesServerAvailable = true;
        return result.photos || [];
      } catch (_) {
        window.cuteMemoriesServerAvailable = false;
        return localDB.getAll();
      }
    },
    async put(photo) {
      if (!window.cuteMemoriesServerAvailable) {
        return localDB.put(photo);
      }
      const blob = photo.blob || photo.file;
      if (!blob) throw new Error('The photo file is missing.');
      const chunkSize = 4 * 1024 * 1024;
      const chunkCount = Math.max(1, Math.ceil(blob.size / chunkSize));
      for (let index = 0; index < chunkCount; index++) {
        const form = new FormData();
        form.append('id', photo.id);
        form.append('index', String(index));
        form.append('chunkCount', String(chunkCount));
        form.append('chunk', blob.slice(index * chunkSize, (index + 1) * chunkSize), `${photo.id}-${index}.part`);
        await request('/api/photos/chunk', { method: 'PUT', body: form });
      }
      await request('/api/photos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complete: true, id: photo.id, chunkCount, type: blob.type || 'image/jpeg',
          title: photo.title || '', description: photo.description || '', album: photo.album || '',
          createdAt: photo.createdAt || new Date().toISOString() })
      });
      return photo;
    },
    async delete(id) {
      if (!window.cuteMemoriesServerAvailable) return localDB.delete(id);
      await request(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async clear() {
      if (!window.cuteMemoriesServerAvailable) return localDB.clear();
      await request('/api/photos', { method: 'DELETE' });
    },
    async getState() {
      if (!window.cuteMemoriesServerAvailable) return null;
      return request('/api/state');
    },
    async toggleLike(photoId, visitorId) {
      return request('/api/state/like', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, visitorId }) });
    },
    async addComment(photoId, name, text) {
      return request('/api/state/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, name, text }) });
    },
    async deleteComment(commentId) {
      await request(`/api/state/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    },
    async saveAlbums(albums) {
      await request('/api/state/albums', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums }) });
    },
    async saveTheme(theme) {
      await request('/api/state/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(theme) });
    }
  };

  window.MemoryStore = {
    get(key, fallback) { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } },
    remove(key) { localStorage.removeItem(key); }
  };
})();
