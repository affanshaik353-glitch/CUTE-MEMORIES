import base64
import binascii
import json
import mimetypes
import os
import re
import cgi
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PHOTO_DIR = DATA / "photos"
CHUNK_DIR = DATA / "chunks"
INDEX = DATA / "photos.json"
MAX_PHOTO_BYTES = 30 * 1024 * 1024 * 1024
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
CHUNK_DIR.mkdir(parents=True, exist_ok=True)
if not INDEX.exists():
    INDEX.write_text("[]", encoding="utf-8")

R2_ENABLED = bool(os.environ.get("R2_ACCESS_KEY_ID") and os.environ.get("R2_SECRET_ACCESS_KEY"))
R2_BUCKET = os.environ.get("R2_BUCKET", "")


def r2_client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )


def r2_key(photo_id):
    return f"photos/{Path(photo_id).name}.bin"


def r2_object_exists(photo_id):
    try:
        r2_client().head_object(Bucket=R2_BUCKET, Key=r2_key(photo_id))
        return True
    except (BotoCoreError, ClientError):
        return False


def load_photos():
    if R2_ENABLED:
        try:
            body = r2_client().get_object(Bucket=R2_BUCKET, Key="photos.json")["Body"].read()
            return json.loads(body.decode("utf-8"))
        except (BotoCoreError, ClientError, json.JSONDecodeError, KeyError):
            return []
    try:
        return json.loads(INDEX.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_photos(photos):
    if R2_ENABLED:
        r2_client().put_object(
            Bucket=R2_BUCKET,
            Key="photos.json",
            Body=(json.dumps(photos, indent=2) + "\n").encode("utf-8"),
            ContentType="application/json"
        )
        return
    INDEX.write_text(json.dumps(photos, indent=2) + "\n", encoding="utf-8")


def stored_bytes():
    if R2_ENABLED:
        total = 0
        paginator = r2_client().get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix="photos/"):
            total += sum(item.get("Size", 0) for item in page.get("Contents", []))
        return total
    return sum(path.stat().st_size for path in PHOTO_DIR.glob("*.bin") if path.is_file())


def chunk_dir(photo_id):
    directory = CHUNK_DIR / photo_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory


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
                if (R2_ENABLED and r2_object_exists(photo["id"])) or (not R2_ENABLED and image.exists()):
                    photos.append({**photo, "imageUrl": f'/api/photos/{photo["id"]}/image'})
            self.send_json(200, {"photos": photos})
            return
        path = urlparse(self.path).path
        if path.startswith("/api/photos/") and path.endswith("/image"):
            photo_id = unquote(path[len("/api/photos/"):-len("/image")])
            if R2_ENABLED and re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                try:
                    response = r2_client().get_object(Bucket=R2_BUCKET, Key=r2_key(photo_id))
                    body = response["Body"]
                    self.send_response(200)
                    self.send_header("Content-Type", response.get("ContentType", "application/octet-stream"))
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    while True:
                        block = body.read(1024 * 1024)
                        if not block:
                            break
                        self.wfile.write(block)
                    body.close()
                    return
                except (BotoCoreError, ClientError):
                    pass
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
        request_path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if request_path == "/api/photos/chunk":
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type"), "CONTENT_LENGTH": str(length)}
                )
                id_item = form["id"]
                photo_id = id_item.value if id_item is not None and hasattr(id_item, "value") else ""
                index_item = form["index"]
                index = int(index_item.value) if index_item is not None and hasattr(index_item, "value") else -1
                count_item = form["chunkCount"]
                chunk_count = int(count_item.value) if count_item is not None and hasattr(count_item, "value") else 0
                chunk_item = form["chunk"]
                if not re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII) or index < 0 or chunk_count < 1 or chunk_item is None:
                    raise ValueError("Invalid upload chunk.")
                chunk_dir(photo_id).joinpath(f"{index}.part").write_bytes(chunk_item.file.read())
                self.send_json(200, {"ok": True})
                return

            if request_path != "/api/photos":
                self.send_json(404, {"error": "Not found."})
                return
            payload = json.loads(self.rfile.read(length))
            if not payload.get("complete"):
                raise ValueError("Upload must be completed in chunks.")
            photo_id = payload["id"]
            if not re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                raise ValueError("Invalid photo ID.")
            source_dir = chunk_dir(photo_id)
            chunk_count = int(payload["chunkCount"])
            chunks = [source_dir.joinpath(f"{index}.part") for index in range(chunk_count)]
            if chunk_count < 1 or any(not chunk.exists() for chunk in chunks):
                raise ValueError("One or more upload chunks are missing.")
            total_size = sum(chunk.stat().st_size for chunk in chunks)
            output = photo_file(photo_id)
            old_size = output.stat().st_size if output.exists() else 0
            if stored_bytes() - old_size + total_size > MAX_PHOTO_BYTES:
                raise ValueError("The 30 GB gallery storage limit has been reached.")
            with output.open("wb") as destination:
                for chunk in chunks:
                    with chunk.open("rb") as source:
                        while True:
                            block = source.read(1024 * 1024)
                            if not block:
                                break
                            destination.write(block)
            if R2_ENABLED:
                with output.open("rb") as source:
                    r2_client().put_object(
                        Bucket=R2_BUCKET,
                        Key=r2_key(photo_id),
                        Body=source.read(),
                        ContentType=payload.get("type", "image/jpeg"),
                        CacheControl="public, max-age=86400"
                    )
                output.unlink(missing_ok=True)
            for chunk in chunks:
                chunk.unlink(missing_ok=True)
            source_dir.rmdir()
            photos = load_photos()
            metadata = {
                "id": photo_id,
                "title": str(payload.get("title", ""))[:80],
                "description": str(payload.get("description", ""))[:300],
                "album": str(payload.get("album", ""))[:80],
                "createdAt": str(payload.get("createdAt", "")),
                "type": payload.get("type", "image/jpeg")
            }
            save_photos([photo for photo in photos if photo["id"] != photo_id] + [metadata])
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
                if R2_ENABLED:
                    r2_client().delete_object(Bucket=R2_BUCKET, Key=r2_key(photo["id"]))
            save_photos([])
            self.send_json(200, {"ok": True})
            return
        if path.startswith("/api/photos/"):
            photo_id = unquote(path[len("/api/photos/"):])
            if re.fullmatch(r"photo-[\w-]+", photo_id, re.ASCII):
                photo_file(photo_id).unlink(missing_ok=True)
                if R2_ENABLED:
                    r2_client().delete_object(Bucket=R2_BUCKET, Key=r2_key(photo_id))
                save_photos([photo for photo in load_photos() if photo["id"] != photo_id])
                self.send_json(200, {"ok": True})
                return
        self.send_json(404, {"error": "Not found."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8081"))
    print(f"Cute Memories is running at http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
