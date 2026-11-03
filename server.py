import base64
import binascii
import json
import mimetypes
import re
import cgi
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PHOTO_DIR = DATA / "photos"
INDEX = DATA / "photos.json"
MAX_PHOTO_BYTES = 30 * 1024 * 1024 * 1024
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
if not INDEX.exists():
    INDEX.write_text("[]", encoding="utf-8")


def load_photos():
    try:
        return json.loads(INDEX.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_photos(photos):
    INDEX.write_text(json.dumps(photos, indent=2) + "\n", encoding="utf-8")


def stored_bytes():
    return sum(path.stat().st_size for path in PHOTO_DIR.glob("*.bin") if path.is_file())


def photo_file(photo_id):
    return PHOTO_DIR / f"{Path(photo_id).name}.bin"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/photos":
            photos = []
            for photo in load_photos():
                image = photo_file(photo["id"])
                if image.exists():
                    photos.append({**photo, "imageUrl": f'/api/photos/{photo["id"]}/image'})
            self.send_json(200, {"photos": photos})
            return
        path = urlparse(self.path).path
        if path.startswith("/api/photos/") and path.endswith("/image"):
            photo_id = unquote(path[len("/api/photos/"):-len("/image")])
            if re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII) and photo_file(photo_id).exists():
                photo = next((item for item in load_photos() if item["id"] == photo_id), None)
                if photo:
                    body = photo_file(photo_id).read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", photo["type"])
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
        super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/photos":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_PHOTO_BYTES + (4 * 1024 * 1024):
                raise ValueError("Upload exceeds the 30 GB limit.")
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type"), "CONTENT_LENGTH": str(length)}
            )
            def field(name):
                item = form[name]
                return item.value if item is not None and hasattr(item, "value") else ""
            payload = {name: field(name) for name in ("id", "title", "description", "album", "createdAt")}
            upload = form["photo"]
            photo_id = payload.get("id", "")
            if not re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                raise ValueError("Invalid photo ID.")
            if upload is None or not getattr(upload, "filename", None):
                raise ValueError("Photo file is missing.")
            image_type = upload.type.lower() if upload.type in ("image/jpeg", "image/png", "image/webp") else ""
            if not image_type:
                raise ValueError("Invalid photo data.")
            file_data = upload.file.read()
            old_file = photo_file(photo_id)
            projected_size = stored_bytes() + len(file_data)
            if old_file.exists():
                projected_size -= old_file.stat().st_size
            if projected_size > MAX_PHOTO_BYTES:
                raise ValueError("The 30 GB gallery storage limit has been reached.")
            old_file.write_bytes(file_data)
            metadata = {
                "id": photo_id,
                "title": str(payload.get("title", ""))[:80],
                "description": str(payload.get("description", ""))[:300],
                "album": str(payload.get("album", ""))[:80],
                "createdAt": str(payload.get("createdAt", "")),
                "type": image_type
            }
            photos = [photo for photo in load_photos() if photo["id"] != photo_id]
            photos.append(metadata)
            save_photos(photos)
            self.send_json(200, {"ok": True})
        except (ValueError, json.JSONDecodeError, binascii.Error) as error:
            self.send_json(400, {"error": str(error)})
        except OSError as error:
            self.send_json(500, {"error": str(error)})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/photos":
            for photo in load_photos():
                photo_file(photo["id"]).unlink(missing_ok=True)
            save_photos([])
            self.send_json(200, {"ok": True})
            return
        if path.startswith("/api/photos/"):
            photo_id = unquote(path[len("/api/photos/"):])
            if re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                photo_file(photo_id).unlink(missing_ok=True)
                save_photos([photo for photo in load_photos() if photo["id"] != photo_id])
                self.send_json(200, {"ok": True})
                return
        self.send_json(404, {"error": "Not found."})


if __name__ == "__main__":
    port = 8081
    print(f"Cute Memories is running at http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
