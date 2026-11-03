(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const KEYS = { comments: 'cuteComments', likes: 'cuteLikes', likedBy: 'cuteLikedBy', albums: 'cuteAlbums', theme: 'cuteTheme', visitor: 'cuteVisitor' };
  const DEFAULT_ALBUMS = ['Our Favorites', 'Celebrations', 'Little Adventures'];
  let photos = [];
  let currentLightbox = -1;
  let commentPhotoId = null;
  let cameraStream = null;
  let capturedBlob = null;
  let currentFacing = 'environment';
  let uploadQueue = [];

  function uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function toast(message, error = false) {
    const el = document.createElement('div');
    el.className = `toast${error ? ' error' : ''}`;
    el.textContent = message;
    $('#toastRegion').append(el);
    setTimeout(() => el.remove(), 3500);
  }
  function isAdmin() { return sessionStorage.getItem('cuteMemoriesAdmin') === 'true'; }
  function visitorId() {
    let id = MemoryStore.get(KEYS.visitor, null);
    if (!id) { id = uid('visitor'); MemoryStore.set(KEYS.visitor, id); }
    return id;
  }
  function getLikes(id) { return MemoryStore.get(KEYS.likes, {})[id] || 0; }
  function setLike(id, value) {
    const likes = MemoryStore.get(KEYS.likes, {});
    likes[id] = value;
    MemoryStore.set(KEYS.likes, likes);
  }
  function comments(id) { return MemoryStore.get(KEYS.comments, {})[id] || []; }
  function albums() {
    const saved = MemoryStore.get(KEYS.albums, null);
    if (!Array.isArray(saved)) { MemoryStore.set(KEYS.albums, DEFAULT_ALBUMS); return [...DEFAULT_ALBUMS]; }
    return saved;
  }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function photoURL(photo) {
    if (photo.imageUrl) return `${window.CUTE_MEMORIES_API_BASE || ''}${photo.imageUrl}`;
    if (photo.image) return photo.image;
    return photo.blob ? URL.createObjectURL(photo.blob) : '';
  }

  async function loadPhotos() {
    try {
      photos = await MemoryDB.getAll();
      photos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      await syncSharedState();
    } catch (error) {
      toast(`Photo server error: ${error.message}`, true);
      photos = [];
    }

    async function syncSharedState() {
      if (!window.cuteMemoriesServerAvailable) return;
      try {
        const state = await MemoryDB.getState();
        MemoryStore.set(KEYS.likes, state.likes || {});
        MemoryStore.set(KEYS.likedBy, state.likedBy || {});
        MemoryStore.set(KEYS.comments, state.comments || {});
        MemoryStore.set(KEYS.albums, state.albums && state.albums.length ? state.albums : DEFAULT_ALBUMS);
        MemoryStore.set(KEYS.theme, state.theme || {});
        if (typeof applyTheme === 'function') applyTheme(state.theme && Object.keys(state.theme).length ? state.theme : null);
      } catch (error) {
        console.warn(error.message);
      }
    }
  }

  function renderGallery() {
    const query = $('#gallerySearch').value.trim().toLowerCase();
    const sort = $('#gallerySort').value;
    let shown = photos.filter(photo => `${photo.title} ${photo.description} ${photo.album}`.toLowerCase().includes(query));
    shown.sort((a, b) => sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt)
      : sort === 'liked' ? getLikes(b.id) - getLikes(a.id) : new Date(b.createdAt) - new Date(a.createdAt));
    $('#gallery').innerHTML = '';
    $('#galleryEmpty').classList.toggle('hidden', shown.length > 0);
    shown.forEach(photo => $('#gallery').append(createPhotoCard(photo)));
    const liked = [...photos].sort((a, b) => getLikes(b.id) - getLikes(a.id)).slice(0, 6);
    $('#likedGallery').innerHTML = '';
    liked.filter(photo => getLikes(photo.id) > 0).forEach(photo => $('#likedGallery').append(createPhotoCard(photo)));
    if (!liked.some(photo => getLikes(photo.id) > 0)) $('#likedGallery').innerHTML = '<div class="empty-state"><div class="empty-art">♡</div><h3>No favorites yet</h3><p>Tap a heart on a memory to add it here.</p></div>';
  }

  function createPhotoCard(photo) {
    const card = document.createElement('article');
    card.className = 'photo-card';
    const liked = (MemoryStore.get(KEYS.likedBy, {})[visitorId()] || []).includes(photo.id);
    card.innerHTML = `
      <div class="photo-image-wrap" role="button" tabindex="0" aria-label="Open ${escapeHTML(photo.title || 'photo')} full screen">
        <img src="${photoURL(photo)}" alt="${escapeHTML(photo.title || 'A cute memory')}" loading="lazy">
        <span class="photo-album">${escapeHTML(photo.album || 'Unsorted')}</span>
      </div>
      <div class="photo-info">
        <h3>${escapeHTML(photo.title || 'A beautiful memory')}</h3>
        <p>${escapeHTML(photo.description || '')}</p>
        <div class="photo-meta">
          <small class="photo-date">${formatDate(photo.createdAt)}</small>
          <div class="photo-actions">
            <button class="action-button like-button${liked ? ' liked' : ''}" aria-label="${liked ? 'Unlike' : 'Like'} photo" title="Like">♥ <span>${getLikes(photo.id)}</span></button>
            <button class="action-button comment-button" aria-label="Open comments" title="Comments">♡ <span>${comments(photo.id).length}</span></button>
          </div>
        </div>
      </div>`;
    const open = () => openLightbox(photo.id);
    card.querySelector('.photo-image-wrap').addEventListener('click', open);
    card.querySelector('.photo-image-wrap').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
    card.querySelector('.like-button').addEventListener('click', () => toggleLike(photo.id));
    card.querySelector('.comment-button').addEventListener('click', () => openComments(photo.id));
    return card;
  }

  function toggleLike(id) {
    if (!window.cuteMemoriesServerAvailable) {
      const byVisitor = MemoryStore.get(KEYS.likedBy, {});
      if (!byVisitor[visitorId()]) byVisitor[visitorId()] = [];
      const list = byVisitor[visitorId()];
      const index = list.indexOf(id);
      if (index >= 0) { list.splice(index, 1); setLike(id, Math.max(0, getLikes(id) - 1)); }
      else { list.push(id); setLike(id, getLikes(id) + 1); }
      MemoryStore.set(KEYS.likedBy, byVisitor);
      renderGallery();
      return;
    }
    MemoryDB.toggleLike(id, visitorId()).then(syncSharedState).then(() => {
      renderGallery();
      if (!$('#dashboard').classList.contains('hidden')) renderAdminCurrent();
    }).catch(error => toast(error.message, true));
  }

  function renderAlbums() {
    const grid = $('#albumGrid');
    grid.innerHTML = '';
    albums().forEach(name => {
      const count = photos.filter(photo => photo.album === name).length;
      const button = document.createElement('button');
      button.className = 'album-card';
      button.innerHTML = `<span class="folder-tab"></span><h3>${escapeHTML(name)}</h3><small>${count} ${count === 1 ? 'memory' : 'memories'}</small>`;
      button.addEventListener('click', () => openAlbum(name));
      grid.append(button);
    });
    if (!albums().length) grid.innerHTML = '<div class="empty-state"><h3>No albums yet</h3><p>Your administrator can create one from the dashboard.</p></div>';
  }

  function openAlbum(name) {
    $('#albumDialogTitle').textContent = name;
    const container = $('#albumDialogPhotos');
    container.innerHTML = '';
    const albumPhotos = photos.filter(photo => photo.album === name);
    if (!albumPhotos.length) container.innerHTML = '<div class="empty-state"><h3>This album is waiting</h3><p>Add photos to it from the admin dashboard.</p></div>';
    albumPhotos.forEach(photo => container.append(createPhotoCard(photo)));
    $('#albumDialog').showModal();
  }

  function openLightbox(id) {
    const index = photos.findIndex(photo => photo.id === id);
    if (index < 0) return;
    currentLightbox = index;
    showLightboxPhoto();
    $('#lightbox').showModal();
  }
  function showLightboxPhoto() {
    if (!photos.length) return;
    currentLightbox = (currentLightbox + photos.length) % photos.length;
    const photo = photos[currentLightbox];
    const url = photoURL(photo);
    $('#lightboxImage').src = url;
    $('#lightboxImage').alt = photo.title || 'Photo memory';
    $('#lightboxTitle').textContent = photo.title || 'A beautiful memory';
    $('#lightboxDescription').textContent = photo.description || '';
    $('#lightboxDate').textContent = formatDate(photo.createdAt);
  }

  function openComments(id) {
    commentPhotoId = id;
    const photo = photos.find(item => item.id === id);
    $('#commentPhotoTitle').textContent = photo ? `— ${photo.title || 'Memory'}` : '';
    renderComments();
    $('#commentsDialog').showModal();
  }
  function renderComments() {
    const list = $('#commentsList');
    list.innerHTML = '';
    const items = comments(commentPhotoId);
    if (!items.length) { list.innerHTML = '<p class="muted">No comments yet. Be the first to leave some love.</p>'; return; }
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'comment';
      const name = escapeHTML(item.name);
      const text = escapeHTML(item.text);
      row.innerHTML = `<div class="comment-avatar">♡</div><div><strong>${name}</strong><small>${new Date(item.createdAt).toLocaleString()}</small><p>${text}</p></div>`;
      list.append(row);
    });
  }
  $('#commentText').addEventListener('input', () => { $('#commentChars').textContent = $('#commentText').value.length; });
  $('#commentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#commentNickname').value.trim();
    const text = $('#commentText').value.trim();
    if (!name || !text) return toast('Please enter a nickname and comment.', true);
    if (window.cuteMemoriesServerAvailable) {
      await MemoryDB.addComment(commentPhotoId, name, text).catch(error => { toast(error.message, true); });
      await syncSharedState();
      renderGallery();
    } else {
      const all = MemoryStore.get(KEYS.comments, {});
      if (!all[commentPhotoId]) all[commentPhotoId] = [];
      all[commentPhotoId].push({ id: uid('comment'), name, text, createdAt: new Date().toISOString() });
      if (!MemoryStore.set(KEYS.comments, all)) return toast('Could not save your comment because browser storage is full.', true);
    }
    $('#commentForm').reset(); $('#commentChars').textContent = '0'; renderComments(); renderGallery(); toast('Your sweet comment was added.');
  });

  function showLogin(show = true) {
    if (show) $('#loginDialog').showModal(); else $('#loginDialog').close();
  }
  $('#adminLoginNav').addEventListener('click', () => showLogin());
  $('#togglePassword').addEventListener('click', () => {
    const field = $('#adminPassword');
    field.type = field.type === 'password' ? 'text' : 'password';
  });
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const response = await fetch(`${window.CUTE_MEMORIES_API_BASE || ''}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: $('#adminUser').value.trim(),
          password: $('#adminPassword').value
        }),
        signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Invalid administrator credentials.');
      sessionStorage.setItem('cuteMemoriesApiToken', result.token);
      sessionStorage.setItem('cuteMemoriesAdmin', 'true');
      $('#loginDialog').close(); $('#loginForm').reset();
      updateAdminUI(); openDashboard(); toast('Welcome back, Administrator!');
    } catch (error) {
      $('#loginError').textContent = error.message.includes('404') || /Could not connect/.test(error.message)
        ? 'The shared photo API is unavailable. Deploy render.yaml as the "cute-memories-api" Render service and configure its HTTPS URL.'
        : error.message;
      setTimeout(() => { $('#loginError').textContent = ''; }, 5000);
    }
  });
  function logout() {
    sessionStorage.removeItem('cuteMemoriesAdmin');
    sessionStorage.removeItem('cuteMemoriesApiToken');
    updateAdminUI(); closeDashboard(); stopCamera(); toast('You have been logged out.');
  }
  $('#logoutNav').addEventListener('click', logout); $('#adminLogout').addEventListener('click', logout);
  function updateAdminUI() {
    const admin = isAdmin();
    $('#adminLoginNav').classList.toggle('hidden', admin);
    $('#logoutNav').classList.toggle('hidden', !admin);
    $('#dashboardNav').classList.toggle('hidden', !admin);
    ['addPhotosNav', 'capturePhotoNav', 'themeNav'].forEach(id => $(`#${id}`).classList.toggle('hidden', !admin));
  }

  function openDashboard() {
    if (!isAdmin()) return showLogin();
    $('#dashboard').classList.remove('hidden');
    window.scrollTo(0, 0);
    document.body.style.overflow = 'hidden';
    renderAdminTab('overview');
  }
  function closeDashboard() {
    $('#dashboard').classList.add('hidden');
    document.body.style.overflow = '';
    stopCamera();
  }
  $('#dashboardNav').addEventListener('click', openDashboard);
  $('#addPhotosNav').addEventListener('click', () => { openDashboard(); activateAdminTab('photos'); });
  $('#capturePhotoNav').addEventListener('click', () => { openDashboard(); activateAdminTab('camera'); });
  $('#themeNav').addEventListener('click', () => { openDashboard(); activateAdminTab('theme'); });
  $('#closeDashboard').addEventListener('click', closeDashboard);
  $$('.admin-tab').forEach(button => button.addEventListener('click', () => {
    $$('.admin-tab').forEach(tab => tab.classList.remove('active')); button.classList.add('active'); renderAdminTab(button.dataset.tab);
  }));

  function renderAdminCurrent() {
    const active = $('.admin-tab.active');
    if (active) renderAdminTab(active.dataset.tab);
  }
  function activateAdminTab(tab) {
    const button = $(`.admin-tab[data-tab="${tab}"]`);
    if (!button) return;
    $$('.admin-tab').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    renderAdminTab(tab);
  }
  function renderAdminTab(tab) {
    const content = $('#adminContent');
    if (tab === 'overview') return renderOverview(content);
    if (tab === 'photos') return renderUpload(content);
    if (tab === 'manage') return renderManage(content);
    if (tab === 'camera') return renderCamera(content);
    if (tab === 'albums') return renderAlbumAdmin(content);
    if (tab === 'theme') return renderTheme(content);
  }
  function renderOverview(content) {
    const likes = photos.reduce((total, photo) => total + getLikes(photo.id), 0);
    const commentCount = photos.reduce((total, photo) => total + comments(photo.id).length, 0);
    content.innerHTML = `<div class="stats-grid">
      <div class="stat-card"><span>📷</span><strong>${photos.length}</strong><p>Total photos</p></div>
      <div class="stat-card"><span>♥</span><strong>${likes}</strong><p>Total likes</p></div>
      <div class="stat-card"><span>♡</span><strong>${commentCount}</strong><p>Total comments</p></div></div>`;
  }
  function renderUpload(content) {
    const maximumLabel = window.location.hostname.endsWith('github.io') ? 'Maximum 90 MB each' : 'Maximum 30 GB each';
    content.innerHTML = `<div class="admin-panel"><h3>Add Photos</h3><div class="upload-zone"><strong>Choose one or more memories</strong><p>JPG, JPEG, PNG or WEBP · ${maximumLabel}</p><input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></div><div id="photoPreviews" class="preview-grid"></div>
      <div class="admin-form-grid"><label>Photo title<input id="uploadTitle" maxlength="80"></label><label>Album<select id="uploadAlbum">${albums().map(name => `<option>${escapeHTML(name)}</option>`).join('')}<option value="">Unsorted</option></select></label></div><label>Description<textarea id="uploadDescription" maxlength="300"></textarea></label>
      <button id="saveUploads" class="form-button">Save Memories</button><progress id="uploadProgress" max="100" value="0" style="width:100%;display:none"></progress></div>`;
    $('#photoFiles').addEventListener('change', previewUploads);
    $('#saveUploads').addEventListener('click', saveUploads);
  }
  function previewUploads(event) {
    const isGithubPages = window.location.hostname.endsWith('github.io');
    const maximumSize = isGithubPages ? 90 * 1024 * 1024 : 30 * 1024 * 1024 * 1024;
    uploadQueue = [...event.target.files].filter(file => file.type.startsWith('image/') && ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= maximumSize);
    const preview = $('#photoPreviews'); preview.innerHTML = '';
    uploadQueue.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = document.createElement('img'); img.src = url; img.alt = file.name; preview.append(img);
    });
    if (uploadQueue.length !== event.target.files.length) {
      toast(isGithubPages ? 'Some files were skipped. Use JPG, PNG or WEBP images smaller than 90 MB.' : 'Some files were skipped. Use JPG, PNG or WEBP images smaller than 30 GB.', true);
    }
  }
  async function saveUploads() {
    if (!uploadQueue.length) return toast('Choose at least one photo.', true);
    const progress = $('#uploadProgress'); progress.style.display = 'block';
    try {
      for (let i = 0; i < uploadQueue.length; i++) {
        const file = uploadQueue[i];
        await MemoryDB.put({
          id: uid('photo'), blob: file, title: uploadQueue.length === 1 ? $('#uploadTitle').value.trim() : file.name.replace(/\.[^.]+$/, ''),
          description: uploadQueue.length === 1 ? $('#uploadDescription').value.trim() : '', album: $('#uploadAlbum').value, createdAt: new Date().toISOString()
        });
        progress.value = Math.round(((i + 1) / uploadQueue.length) * 100);
      }
      await loadPhotos(); renderGallery(); renderAlbums(); renderOverview($('#adminContent'));       toast(`${uploadQueue.length} memory${uploadQueue.length > 1 ? 'ies' : ' added'}`);
      uploadQueue = []; renderAdminTab('photos');
    } catch (error) { toast(`Could not save photos: ${error.message}`, true); }
  }

  function renderManage(content) {
    const list = document.createElement('div'); list.className = 'manage-list';
    content.innerHTML = `<div class="admin-panel"><h3>Manage Photos</h3><div class="manage-list"></div></div>`;
    if (!photos.length) { $('.manage-list').innerHTML = '<p>No photos to manage yet.</p>'; return; }
    photos.forEach(photo => {
      const row = document.createElement('div'); row.className = 'manage-item';
      row.innerHTML = `<img src="${photoURL(photo)}" alt=""><div><strong>${escapeHTML(photo.title || 'Untitled memory')}</strong><p>${escapeHTML(photo.description || '')}</p><small>♥ ${getLikes(photo.id)} · ${comments(photo.id).length} comments · ${escapeHTML(photo.album || 'Unsorted')}</small></div><div class="manage-item-actions"><button class="secondary-button edit-photo">Edit</button><button class="secondary-button manage-comments">Comments</button><button class="danger-button delete-photo">Delete</button></div>`;
      row.querySelector('.edit-photo').addEventListener('click', () => editPhoto(photo));
      row.querySelector('.manage-comments').addEventListener('click', () => deleteComment(photo.id));
      row.querySelector('.delete-photo').addEventListener('click', () => deletePhoto(photo.id));
      $('.manage-list').append(row);
    });
  }
  async function deleteComment(photoId) {
    const photo = photos.find(item => item.id === photoId);
    const items = comments(photoId);
    if (!items.length) return toast('This photo has no comments.');
    const lines = items.map((item, index) => `${index + 1}. ${item.name}: ${item.text}`).join('\n');
    const choice = prompt(`Choose a comment number to delete:\n\n${lines}`);
    if (choice === null) return;
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return toast('Invalid comment number.', true);
    if (!confirm(`Delete the comment by "${items[index].name}"?`)) return;
    if (window.cuteMemoriesServerAvailable) {
      await MemoryDB.deleteComment(items[index].id).catch(error => { toast(error.message, true); return; });
      await syncSharedState();
    } else {
      items.splice(index, 1);
      const all = MemoryStore.get(KEYS.comments, {});
      all[photoId] = items;
      MemoryStore.set(KEYS.comments, all);
    }
    renderGallery();
    renderManage($('#adminContent'));
    toast('Comment deleted.');
  }
  async function editPhoto(photo) {
    const title = prompt('Photo title:', photo.title || '');
    if (title === null) return;
    const description = prompt('Photo description:', photo.description || '');
    if (description === null) return;
    const choices = [...albums(), ''].join('\n');
    const album = prompt(`Album (enter one of):\n${choices}`, photo.album || '');
    if (album === null) return;
    photo.title = title.trim().slice(0, 80); photo.description = description.trim().slice(0, 300);
    photo.album = album.trim();
    await MemoryDB.put(photo); await loadPhotos(); renderGallery(); renderAlbums(); renderManage($('#adminContent')); toast('Memory updated.');
  }
  async function deletePhoto(id) {
    if (!confirm('Delete this photo permanently? This cannot be undone.')) return;
    try { await MemoryDB.delete(id); await loadPhotos(); renderGallery(); renderAlbums(); renderManage($('#adminContent')); toast('Photo deleted.'); }
    catch (error) { toast(error.message, true); }
  }

  function renderCamera(content) {
    content.innerHTML = `<div class="admin-panel"><h3>Capture a Memory 📸</h3><video id="cameraPreview" class="camera-preview" autoplay playsinline muted></video><canvas id="captureCanvas" hidden></canvas><img id="capturedPreview" class="camera-preview hidden" alt="Captured memory preview"><div class="camera-controls"><button id="startCamera" class="capture">Start Camera</button><button id="switchCamera">Switch Camera</button><button id="takePhoto">Capture Photo</button><button id="retakePhoto">Retake</button><button id="saveCaptured">Save Photo</button></div><p id="cameraStatus" role="status"></p></div>`;
    $('#startCamera').addEventListener('click', startCamera);
    $('#switchCamera').addEventListener('click', async () => { currentFacing = currentFacing === 'environment' ? 'user' : 'environment'; await startCamera(); });
    $('#takePhoto').addEventListener('click', takePhoto); $('#retakePhoto').addEventListener('click', retakePhoto); $('#saveCaptured').addEventListener('click', saveCaptured);
  }
  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) return $('#cameraStatus').textContent = 'Camera access requires a supported browser on HTTPS or localhost.';
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentFacing } }, audio: false });
      $('#cameraPreview').srcObject = cameraStream; $('#cameraPreview').classList.remove('hidden'); $('#capturedPreview').classList.add('hidden');
      $('#cameraStatus').textContent = 'Camera is ready.';
    } catch (error) {
      $('#cameraStatus').textContent = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access and try again.' : 'No camera could be opened. Check that it is connected and available.';
    }
  }
  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  function takePhoto() {
    const video = $('#cameraPreview'); if (!cameraStream || !video.videoWidth) return $('#cameraStatus').textContent = 'Start the camera before capturing.';
    const canvas = $('#captureCanvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      capturedBlob = blob; $('#capturedPreview').src = URL.createObjectURL(blob); $('#capturedPreview').classList.remove('hidden');
      $('#cameraPreview').classList.add('hidden'); stopCamera(); $('#cameraStatus').textContent = 'Photo captured. Retake or save it.';
    }, 'image/jpeg', .92);
  }
  function retakePhoto() { capturedBlob = null; $('#cameraStatus').textContent = 'Ready to try again.'; startCamera(); }
  async function saveCaptured() {
    if (!capturedBlob) return toast('Capture a photo first.', true);
    try {
      await MemoryDB.put({ id: uid('photo'), blob: capturedBlob, title: 'Camera Memory', description: '', album: albums()[0] || '', createdAt: new Date().toISOString() });
      capturedBlob = null; await loadPhotos(); renderGallery(); renderAlbums(); $('#cameraStatus').textContent = 'Photo saved to your gallery.'; toast('Camera memory saved!'); retakePhoto();
    } catch (error) { toast(error.message, true); }
  }

  function renderAlbumAdmin(content) {
    content.innerHTML = `<div class="admin-panel"><h3>Manage Albums</h3><div class="admin-form-grid"><label>New album<input id="newAlbumName" maxlength="50"></label><button id="createAlbum" class="form-button" style="align-self:end">Create Album</button></div><div id="albumAdminList" class="manage-list"></div></div>`;
    $('#createAlbum').addEventListener('click', () => {
      const name = $('#newAlbumName').value.trim(); if (!name) return toast('Enter an album name.', true);
      const list = albums(); if (list.some(item => item.toLowerCase() === name.toLowerCase())) return toast('That album already exists.', true);
      list.push(name); MemoryStore.set(KEYS.albums, list); if (window.cuteMemoriesServerAvailable) MemoryDB.saveAlbums(list).catch(error => toast(error.message, true)); $('#newAlbumName').value = ''; renderAlbums(); renderAlbumAdmin(content); toast('Album created.');
    });
    const list = $('#albumAdminList');
    albums().forEach(name => {
      const row = document.createElement('div'); row.className = 'manage-item';
      row.innerHTML = `<span>📁</span><strong>${escapeHTML(name)}</strong><div><button class="secondary-button rename-album">Rename</button><button class="danger-button delete-album">Delete</button></div>`;
      row.querySelector('.rename-album').addEventListener('click', () => renameAlbum(name));
      row.querySelector('.delete-album').addEventListener('click', () => deleteAlbum(name));
      list.append(row);
    });
  }
  function renameAlbum(oldName) {
    const name = prompt('New album name:', oldName);
    if (!name || !name.trim() || name.trim() === oldName) return;
    const list = albums(); list[list.indexOf(oldName)] = name.trim(); MemoryStore.set(KEYS.albums, list); if (window.cuteMemoriesServerAvailable) MemoryDB.saveAlbums(list).catch(error => toast(error.message, true));
    photos.filter(photo => photo.album === oldName).forEach(photo => { photo.album = name.trim(); MemoryDB.put(photo); });
    setTimeout(async () => { await loadPhotos(); renderAlbums(); renderAlbumAdmin($('#adminContent')); }, 100); toast('Album renamed.');
  }
  async function deleteAlbum(name) {
    if (!confirm(`Delete "${name}"? Photos will be kept and moved to Unsorted.`)) return;
    const nextAlbums = albums().filter(item => item !== name);
    MemoryStore.set(KEYS.albums, nextAlbums);
    if (window.cuteMemoriesServerAvailable) await MemoryDB.saveAlbums(nextAlbums).catch(error => toast(error.message, true));
    for (const photo of photos.filter(item => item.album === name)) { photo.album = ''; await MemoryDB.put(photo); }
    await loadPhotos(); renderAlbums(); renderAlbumAdmin($('#adminContent')); toast('Album deleted.');
  }

  const builtThemes = [
    ['Pink Cloud','linear-gradient(135deg,#fff4f8,#fbe2ed,#ebeffc)'],
    ['Lavender Dream','linear-gradient(135deg,#faf5ff,#e5dcf6,#dbeaff)'],
    ['Baby Blue','linear-gradient(135deg,#effaff,#d9edfb,#fff5f8)'],
    ['Vanilla Cream','linear-gradient(135deg,#fffaf1,#f8ecd9,#fce9ed)'],
    ['Rose Sunset','linear-gradient(135deg,#fff0f1,#f4c7d8,#c9d7ef)']
  ];
  function renderTheme(content) {
    const theme = MemoryStore.get(KEYS.theme, { name:'Pink Cloud', background:builtThemes[0][1], brightness:100, blur:0, overlay:18 });
    content.innerHTML = `<div class="admin-panel"><h3>Change Website Theme 🎨</h3><div class="theme-grid">${builtThemes.map(item => `<button class="theme-swatch${theme.background === item[1] ? ' active' : ''}" style="background:${item[1]}" data-theme-name="${item[0]}" data-theme="${encodeURIComponent(item[1])}" aria-label="${item[0]}"></button>`).join('')}</div>
      <div class="admin-form-grid" style="margin-top:20px"><label>Upload custom background<input id="themeUpload" type="file" accept="image/jpeg,image/png,image/webp"></label><img id="themePreview" class="hidden" style="width:100%;height:90px;object-fit:cover;border-radius:12px"></div>
      <div class="range-row"><label>Brightness</label><input id="themeBrightness" type="range" min="50" max="130" value="${theme.brightness}"><span>${theme.brightness}%</span></div>
      <div class="range-row"><label>Blur</label><input id="themeBlur" type="range" min="0" max="12" value="${theme.blur}"><span>${theme.blur}px</span></div>
      <div class="range-row"><label>Overlay</label><input id="themeOverlay" type="range" min="0" max="70" value="${theme.overlay}"><span>${theme.overlay}%</span></div>
      <div style="display:flex;gap:10px;margin-top:20px"><button id="applyTheme" class="form-button" style="width:auto">Apply Theme</button><button id="resetTheme" class="secondary-button">Reset Theme</button></div></div>`;
    let customBackground = null;
    $$('.theme-swatch').forEach(swatch => swatch.addEventListener('click', () => {
      $$('.theme-swatch').forEach(item => item.classList.remove('active')); swatch.classList.add('active'); customBackground = decodeURIComponent(swatch.dataset.theme);
      content.dataset.themeName = swatch.dataset.themeName;
    }));
    $('#themeUpload').addEventListener('change', event => {
      const file = event.target.files[0]; if (!file) return;
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) return toast('Choose a JPG, PNG or WEBP under 15 MB.', true);
      const reader = new FileReader(); reader.onload = () => { customBackground = `url("${reader.result}")`; $('#themePreview').src = reader.result; $('#themePreview').classList.remove('hidden'); };
      reader.readAsDataURL(file);
    });
    $$('#themeBrightness, #themeBlur, #themeOverlay').forEach(range => range.addEventListener('input', () => {
      range.nextElementSibling.textContent = range.value + (range.id === 'themeBrightness' || range.id === 'themeOverlay' ? '%' : 'px');
    }));
    $('#applyTheme').addEventListener('click', () => {
      const selected = customBackground || theme.background;
      const settings = { name: content.dataset.themeName || theme.name, background:selected, custom: selected.startsWith('url('), brightness:+$('#themeBrightness').value, blur:+$('#themeBlur').value, overlay:+$('#themeOverlay').value };
      MemoryStore.set(KEYS.theme, settings); applyTheme(settings);
      if (window.cuteMemoriesServerAvailable) MemoryDB.saveTheme(settings).catch(error => toast(error.message, true));
      toast('Website theme applied.');
    });
    $('#resetTheme').addEventListener('click', () => { MemoryStore.remove(KEYS.theme); applyTheme(null); if (window.cuteMemoriesServerAvailable) MemoryDB.saveTheme({}).catch(error => toast(error.message, true)); toast('Theme reset.'); });
  }
  function applyTheme(theme) {
    const el = $('#siteTheme'); el.className = ''; el.removeAttribute('style');
    if (!theme) return;
    el.classList.add('custom'); el.style.backgroundImage = theme.background; el.style.setProperty('--theme-brightness', theme.brightness / 100); el.style.setProperty('--theme-blur', `${theme.blur}px`); el.style.setProperty('--theme-overlay', theme.overlay / 100);
    el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center';
  }

  function bindNavigation() {
    $('#menuToggle').addEventListener('click', () => {
      const open = $('#mainNav').classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded', String(open));
    });
    $$('#mainNav a').forEach(link => link.addEventListener('click', () => { $('#mainNav').classList.remove('open'); }));
    $$('.modal-close').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
    $('.lightbox-close').addEventListener('click', () => $('#lightbox').close());
    $('.lightbox-prev').addEventListener('click', () => { currentLightbox--; showLightboxPhoto(); });
    $('.lightbox-next').addEventListener('click', () => { currentLightbox++; showLightboxPhoto(); });
    document.addEventListener('keydown', event => {
      if ($('#lightbox').open && event.key === 'ArrowLeft') { currentLightbox--; showLightboxPhoto(); }
      if ($('#lightbox').open && event.key === 'ArrowRight') { currentLightbox++; showLightboxPhoto(); }
    });
    $('#gallerySearch').addEventListener('input', renderGallery); $('#gallerySort').addEventListener('change', renderGallery);
    window.addEventListener('memory-storage-error', () => toast('Browser storage is full or unavailable.', true));
  }

  async function init() {
    bindNavigation(); await loadPhotos(); albums(); renderGallery(); renderAlbums(); updateAdminUI();
    applyTheme(MemoryStore.get(KEYS.theme, null));
    visitorId();
    setTimeout(() => $('#loader').classList.add('loaded'), 500);
    let refreshTimer;
    async function refreshPhotos() {
      if (document.hidden) return;
      const previousIds = photos.map(photo => photo.id).join('|');
      await loadPhotos();
      if (photos.map(photo => photo.id).join('|') !== previousIds) {
        renderGallery();
        renderAlbums();
      }
    }
    refreshTimer = window.setInterval(refreshPhotos, 30000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !refreshTimer) refreshTimer = window.setInterval(refreshPhotos, 30000);
      if (document.hidden && refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = undefined; }
    });
  }
  init();
})();
