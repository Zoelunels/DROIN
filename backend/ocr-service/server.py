"""DROIN's local OCR service: reads receipt photos with PaddleOCR's PP-OCR models (through RapidOCR,
which runs them on ONNX Runtime, so no PaddlePaddle install is needed).

Private by design: it listens on 127.0.0.1 only and nothing leaves this machine. The models ship
inside the rapidocr package, so it works offline. Only the Python standard library is used for the
HTTP side.

    POST /ocr     body: the image bytes (PNG/JPEG/WebP)
                  -> {"lines": [{"text": "TOTAL", "box": [[x, y] x4], "score": 0.98}, ...],
                      "width": 1800, "height": 2400}
    GET  /health  -> {"status": "ok", "engine": "rapidocr"}

Each "line" is one text box as the detector found it (a word or a run of words). The backend puts
boxes at the same height back together into printed rows, so "TOTAL" on the left and "80.100" on
the right become one line again.

Start it with:  .venv/Scripts/python server.py   (or see backend/README.md)
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rapidocr import RapidOCR

HOST = "127.0.0.1"  # never exposed to the network: receipts stay on this machine
PORT = int(os.environ.get("OCR_SERVICE_PORT", "8866"))
MAX_BYTES = 15 * 1024 * 1024  # same limit as the backend's uploads

print("Loading OCR models…", flush=True)
engine = RapidOCR()
# One engine, one scan at a time: ONNX Runtime already uses every core for a single image, and
# running two at once only makes both slower and doubles the memory.
engine_lock = threading.Lock()


def read(image: bytes) -> dict:
    with engine_lock:
        result = engine(image)
    lines = []
    if result.boxes is not None and result.txts is not None:
        for box, text, score in zip(result.boxes, result.txts, result.scores):
            text = str(text).strip()
            if text:
                lines.append({"text": text, "box": [[float(x), float(y)] for x, y in box], "score": round(float(score), 3)})
    height, width = result.img.shape[:2] if getattr(result, "img", None) is not None else (0, 0)
    return {"lines": lines, "width": int(width), "height": int(height)}


class Handler(BaseHTTPRequestHandler):
    server_version = "droin-ocr/1"

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 (http.server's naming)
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "engine": "rapidocr"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ocr":
            self.send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            self.send_json(413 if length > MAX_BYTES else 400, {"error": "send the image as the request body"})
            return
        image = self.rfile.read(length)
        started = time.perf_counter()
        try:
            body = read(image)
        except Exception as err:  # a broken image, not a broken service
            print(f"OCR failed: {err}", file=sys.stderr, flush=True)
            self.send_json(422, {"error": "couldn't read that image"})
            return
        print(f"OCR: {len(body['lines'])} boxes in {time.perf_counter() - started:.2f}s", flush=True)
        self.send_json(200, body)

    def log_message(self, format: str, *args) -> None:  # the OCR line above is enough
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"DROIN OCR service on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
