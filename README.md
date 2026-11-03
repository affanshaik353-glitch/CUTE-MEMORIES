# CUTE MEMORIES ❤️

A complete responsive photo gallery built with HTML, CSS, vanilla JavaScript, and a small shared Node/Python-style persistence backend.

## Publish for free with GitHub Pages

1. Push this folder to a GitHub repository named `CUTE-MEMORIES`.
2. In GitHub, open **Settings -> Pages**, choose **GitHub Actions** as the source, and run the included **Deploy to GitHub Pages** workflow.
3. Open the Pages URL shown in **Settings -> Pages**.
4. Deploy the Python API separately and set `window.CUTE_MEMORIES_API_BASE` in `index.html` to the API HTTPS URL. GitHub Pages can host only the frontend; it cannot securely host the admin API.

This deployment uses GitHub Pages and repository storage, so there is no paid server, database, or object-storage service to maintain. Public visitors can view photos without a token; uploads and deletes require an authorized repository token.

## Run locally

Run the included Python server:

```bash
cd Cute-Memories
python server.py
```

Then open `http://localhost:8081`. Uploaded photos are stored in `data/photos.json` and `data/photos/`, so every visitor to the same website can see them. Camera capture requires HTTPS or localhost.

## Demo administrator

- User ID: `CUTEMEMORIES123`
- Password: `CUTE_MEMORIES_123@`

These credentials are hardcoded JavaScript for local demonstration only. They are visible to anyone who can inspect browser code and are **not secure authentication**. LocalStorage and IndexedDB are browser storage, not a secure server-side database. A public website needs server-side authentication, authorization, secure secrets, validated uploads, and a database.

## Features

When an API is connected, photos, likes, comments, album metadata, and theme settings are stored on the server and synchronized between visitors. IndexedDB is retained as a development fallback only and does not synchronize devices.
