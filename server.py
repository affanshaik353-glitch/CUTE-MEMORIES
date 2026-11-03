import base64
import binascii
import json
import mimetypes
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PHOTO_DIR = DATA / "photos"
INDEX = DATA / "photos.json"
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
                    encoded = base64.b64encode(image.read_bytes()).decode("ascii")
                    photos.append({**photo, "image": f'data:{photo["type"]};base64,{encoded}'})
            self.send_json(200, {"photos": photos})
            return
        super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/photos":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 30 * 1024 * 1024)
            payload = json.loads(self.rfile.read(length))
            photo_id = payload.get("id", "")
            image = payload.get("image", "")
            if not re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                raise ValueError("Invalid photo ID.")
            match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,(.+)", image, re.IGNORECASE | re.DOTALL)
            if not match:
                raise ValueError("Invalid photo data.")

            image_type = match.group(1).lower()
            photo_file(photo_id).write_bytes(base64.b64decode(match.group(2)))
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
