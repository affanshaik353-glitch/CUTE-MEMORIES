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

  const localPhotos = (() => {
    const DB_NAME = 'CuteMemoriesGitHub';
    const STORE = 'photos';
    let connection;

    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        request.onsuccess = () => { connection = request.result; resolve(connection); };
        request.onerror = () => reject(request.error);
      });
    }

    async function getConnection() {
      return connection || openDB();
    }

    function run(mode, action) {
      return getConnection().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }));
    }

    return {
      getAll: () => run('readonly', store => store.getAll()),
      put: photo => run('readwrite', store => store.put(photo)).then(() => photo),
      delete: id => run('readwrite', store => store.delete(id)).then(() => undefined),
      clear: () => run('readwrite', store => store.clear()).then(() => undefined)
    };
  })();

  const githubPhotos = (() => {
    const owner = 'affanshaik353-glitch';
    const repo = 'CUTE-MEMORIES';
    const manifestPath = 'data/photos.json';
    const headers = () => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${sessionStorage.getItem('githubPhotosToken')}`,
      'X-GitHub-Api-Version': '2022-11-28'
    });

    function getToken() {
      let token = sessionStorage.getItem('githubPhotosToken');
      if (!token) {
        token = window.prompt('Enter a GitHub token with Contents write permission for photo uploads.');
        if (!token) throw new Error('A GitHub upload token is required.');
        sessionStorage.setItem('githubPhotosToken', token.trim());
      }
      return token;
    }

    async function githubJson(path, options = {}) {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `GitHub request failed (${response.status})`);
      return body;
    }

    async function manifestFile() {
      try {
        return await githubJson(manifestPath, { headers: headers(), cache: 'no-store' });
      } catch (error) {
        if (/404|Not Found/.test(error.message)) return null;
        throw error;
      }
    }

    function rawUrl(path) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    }

    async function getAll() {
      const manifest = await fetch(rawUrl(manifestPath), { cache: 'no-store' });
      if (!manifest.ok) return [];
      const photos = await manifest.json();
      return photos.map(photo => ({ ...photo, imageUrl: rawUrl(photo.path) }));
    }

    async function deletePhoto(id) {
      getToken();
      const photos = await getAll();
      const photo = photos.find(item => item.id === id);
      if (!photo) return;
      const file = await githubJson(photo.path, { headers: headers() });
      await githubJson(photo.path, {
        method: 'DELETE',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Delete photo ${id}`, sha: file.sha })
      });
      const manifest = await manifestFile();
      await githubJson(manifestPath, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Remove photo ${id}`,
          content: btoa(unescape(encodeURIComponent(JSON.stringify(
            photos.filter(item => item.id !== id).map(({ imageUrl, ...item }) => item), null, 2
          )))),
          sha: manifest.sha
        })
      });
    }

    async function put(photo) {
      getToken();
      const blob = photo.blob || photo.file;
      if (!blob) throw new Error('Photo data is missing.');
      if (blob.size > 90 * 1024 * 1024) throw new Error('GitHub only supports files up to 90 MB.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const extension = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `photos/${photo.id}.${extension}`;
      const existing = await githubJson(path, { headers: headers() }).catch(() => null);
      await githubJson(path, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Add photo ${photo.id}`,
          content: btoa(binary),
          ...(existing && existing.sha ? { sha: existing.sha } : {})
        })
      });

      const manifest = await manifestFile();
      const photos = manifest && manifest.content
        ? JSON.parse(atob(manifest.content.replace(/\s/g, '')))
        : await getAll().catch(() => []);
      const metadata = {
        id: photo.id,
        path,
        title: photo.title || '',
        description: photo.description || '',
        album: photo.album || '',
        createdAt: photo.createdAt || new Date().toISOString(),
        type: blob.type
      };
      await githubJson(manifestPath, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Update photo gallery ${photo.id}`,
          content: btoa(unescape(encodeURIComponent(JSON.stringify(
            [...photos.filter(item => item.id !== photo.id), metadata], null, 2
          )))),
          ...(manifest && manifest.sha ? { sha: manifest.sha } : {})
        })
      });
      return photo;
    }

    return { getAll, put, delete: deletePhoto };
  })();

  window.MemoryDB = {
    async getAll() {
      if (window.location.hostname.endsWith('github.io')) return githubPhotos.getAll();
      const result = await request('/api/photos');
      return result.photos || [];
    },
    async put(photo) {
      if (window.location.hostname.endsWith('github.io')) return githubPhotos.put(photo);
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
      if (window.location.hostname.endsWith('github.io')) return githubPhotos.delete(id);
      await request(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async clear() {
      if (window.location.hostname.endsWith('github.io')) return localPhotos.clear();
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
