# CUTE MEMORIES ❤️

A complete responsive, browser-based photo gallery built with HTML, CSS, and vanilla JavaScript.

## Publish for free with GitHub Pages

1. Push this folder to a GitHub repository named `CUTE-MEMORIES`.
2. In GitHub, open **Settings -> Pages**, choose **GitHub Actions** as the source, and run the included **Deploy to GitHub Pages** workflow.
3. Open the Pages URL shown in **Settings -> Pages**.
4. When the admin uploads a photo from GitHub Pages, create a fine-grained GitHub token with repository **Contents** read/write permission. Enter it when prompted; it is kept only for the current browser tab.

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

Photos and their metadata are stored on the server. Comments, likes, album metadata, visitor identity, and theme settings still use browser LocalStorage and do not sync between visitors unless a server database is added.
