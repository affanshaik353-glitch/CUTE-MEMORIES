# CUTE MEMORIES ❤️

A complete responsive, browser-based photo gallery built with HTML, CSS, and vanilla JavaScript.

## Run locally

Serve the folder with any static server. For example:

```bash
cd Cute-Memories
python -m http.server 8080
```

Then open `http://localhost:8080`. Camera capture requires HTTPS or localhost.

## Demo administrator

- User ID: `CUTEMEMORIES123`
- Password: `CUTE_MEMORIES_123@`

These credentials are hardcoded JavaScript for local demonstration only. They are visible to anyone who can inspect browser code and are **not secure authentication**. LocalStorage and IndexedDB are browser storage, not a secure server-side database. A public website needs server-side authentication, authorization, secure secrets, validated uploads, and a database.

## Features

Photos and their binary data are stored in IndexedDB. Comments, likes, album metadata, visitor identity, and theme settings use LocalStorage. Use the same browser/profile to retain all data. Clearing site data removes it.
