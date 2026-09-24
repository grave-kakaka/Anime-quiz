#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
动漫答题放映器 — 本地服务

纯 Python 标准库，不需要安装任何依赖。

用法:
    python server.py            # 默认端口 8756
    python server.py 9000       # 指定端口

目录:
    server.py              本文件
    data/questions.json    题库(自动维护, 另存一份 .bak 备份)
    media/                 图片 / 音频 / 视频
    web/                   前端页面
"""

import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
MEDIA_DIR = os.path.join(ROOT, "media")
DATA_DIR = os.path.join(ROOT, "data")
QFILE = os.path.join(DATA_DIR, "questions.json")

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8756
LOCK = threading.RLock()
SAFE_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._\-]+")
CHUNK = 1024 * 1024


# --------------------------------------------------------------------------
# 题库读写
# --------------------------------------------------------------------------

def ensure_layout():
    for d in (WEB_DIR, MEDIA_DIR, DATA_DIR):
        os.makedirs(d, exist_ok=True)
    if not os.path.exists(QFILE):
        write_questions([])


def read_questions():
    with LOCK:
        try:
            with open(QFILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return []
    return data if isinstance(data, list) else []


def write_questions(questions):
    with LOCK:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = QFILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(questions, f, ensure_ascii=False, indent=2)
        if os.path.exists(QFILE):
            try:
                os.replace(QFILE, QFILE + ".bak")
            except OSError:
                pass
        os.replace(tmp, QFILE)


# --------------------------------------------------------------------------
# 文件工具
# --------------------------------------------------------------------------

def safe_name(raw):
    """把上传的文件名洗干净, 防止路径穿越。"""
    name = urllib.parse.unquote(raw or "")
    name = os.path.basename(name.replace("\\", "/")).strip()
    name = SAFE_RE.sub("_", name).strip("._-")
    return (name or "file")[:120]


def unique_path(folder, name):
    base, ext = os.path.splitext(name)
    candidate = os.path.join(folder, name)
    i = 1
    while os.path.exists(candidate):
        candidate = os.path.join(folder, "%s_%d%s" % (base, i, ext))
        i += 1
    return candidate


def media_kind(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in (".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"):
        return "audio"
    if ext in (".mp4", ".webm", ".mov", ".mkv", ".m4v"):
        return "video"
    return "image"


# --------------------------------------------------------------------------
# HTTP 处理
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "AnimeQuiz/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # ---------- 基础响应 ----------

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, folder, rel):
        base = os.path.realpath(folder)
        full = os.path.realpath(os.path.join(base, rel))
        if not full.startswith(base + os.sep) or not os.path.isfile(full):
            return self.send_text("404 Not Found: " + rel, 404)
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng.strip())
            if m:
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = int(m.group(2))
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        with open(full, "rb") as f:
            f.seek(start)
            remain = length
            while remain > 0:
                chunk = f.read(min(CHUNK, remain))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remain -= len(chunk)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        remain = length
        chunks = []
        while remain > 0:
            chunk = self.rfile.read(min(CHUNK, remain))
            if not chunk:
                break
            chunks.append(chunk)
            remain -= len(chunk)
        return b"".join(chunks)

    def read_json(self):
        raw = self.read_body()
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

    # ---------- GET ----------

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/questions":
            return self.send_json({"questions": read_questions()})

        if path == "/api/media":
            files = []
            for name in sorted(os.listdir(MEDIA_DIR)):
                full = os.path.join(MEDIA_DIR, name)
                if os.path.isfile(full):
                    files.append({
                        "name": name,
                        "path": "media/" + name,
                        "kind": media_kind(name),
                        "size": os.path.getsize(full),
                    })
            return self.send_json({"files": files})

        if path.startswith("/media/"):
            return self.send_file(MEDIA_DIR, path[len("/media/"):])

        if path in ("/", "/index.html"):
            return self.send_file(WEB_DIR, "index.html")
        if path == "/play":
            return self.send_file(WEB_DIR, "play.html")
        if path == "/admin":
            return self.send_file(WEB_DIR, "admin.html")
        if path == "/favicon.ico":
            return self.send_text("", 204)

        return self.send_file(WEB_DIR, path.lstrip("/"))

    # ---------- POST ----------

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/upload":
            return self.api_upload(parsed.query)

        if path == "/api/questions":
            return self.api_save_question()

        if path == "/api/delete":
            return self.api_delete()

        if path == "/api/reorder":
            return self.api_reorder()

        return self.send_json({"error": "unknown endpoint"}, 404)

    # ---------- API 实现 ----------

    def api_upload(self, query):
        params = urllib.parse.parse_qs(query)
        name = safe_name((params.get("name") or ["file"])[0])
        dest = unique_path(MEDIA_DIR, name)
        length = int(self.headers.get("Content-Length") or 0)
        remain = length
        written = 0
        with open(dest, "wb") as f:
            while remain > 0:
                chunk = self.rfile.read(min(CHUNK, remain))
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
                remain -= len(chunk)
        if written == 0:
            try:
                os.remove(dest)
            except OSError:
                pass
            return self.send_json({"error": "empty file"}, 400)
        name = os.path.basename(dest)
        return self.send_json({
            "path": "media/" + name,
            "name": name,
            "kind": media_kind(name),
            "size": written,
        })

    def api_save_question(self):
        with LOCK:
            return self._save_question()

    def _save_question(self):
        item = self.read_json()
        if not isinstance(item, dict) or not (item.get("question") or "").strip():
            return self.send_json({"error": "question text is required"}, 400)

        options = [str(o).strip() for o in (item.get("options") or [])]
        options = [o for o in options if o]
        if len(options) < 2:
            return self.send_json({"error": "at least 2 options required"}, 400)

        try:
            answer = int(item.get("answer", 0))
        except (TypeError, ValueError):
            answer = 0
        answer = max(0, min(answer, len(options) - 1))

        media = item.get("media")
        if isinstance(media, dict) and media.get("src"):
            media = {
                "kind": media.get("kind") or media_kind(str(media.get("src"))),
                "src": str(media.get("src")),
                "start": float(media.get("start") or 0),
                "end": float(media.get("end") or 0),
                "blur": float(media.get("blur") or 0),
                "poster": str(media.get("poster") or ""),
            }
        else:
            media = None

        questions = read_questions()
        qid = str(item.get("id") or "").strip()
        record = {
            "id": qid or "q" + uuid.uuid4().hex[:12],
            "type": item.get("type") or ("choice" if not media else media["kind"]),
            "category": str(item.get("category") or "").strip(),
            "difficulty": int(item.get("difficulty") or 1),
            "question": item.get("question").strip(),
            "media": media,
            "options": options,
            "answer": answer,
            "explain": str(item.get("explain") or "").strip(),
        }

        found = False
        for i, q in enumerate(questions):
            if str(q.get("id")) == record["id"]:
                questions[i] = record
                found = True
                break
        if not found:
            questions.append(record)
        write_questions(questions)
        return self.send_json({"question": record, "created": not found})

    def api_delete(self):
        with LOCK:
            return self._delete()

    def _delete(self):
        item = self.read_json()
        qid = str(item.get("id") or "")
        if not qid:
            return self.send_json({"error": "id required"}, 400)
        questions = [q for q in read_questions() if str(q.get("id")) != qid]
        write_questions(questions)
        return self.send_json({"ok": True, "count": len(questions)})

    def api_reorder(self):
        with LOCK:
            return self._reorder()

    def _reorder(self):
        item = self.read_json()
        ids = [str(i) for i in (item.get("ids") or [])]
        if not ids:
            return self.send_json({"error": "ids required"}, 400)
        questions = read_questions()
        index = {str(q.get("id")): q for q in questions}
        ordered = [index[i] for i in ids if i in index]
        ordered += [q for q in questions if str(q.get("id")) not in set(ids)]
        write_questions(ordered)
        return self.send_json({"ok": True, "count": len(ordered)})

    def do_DELETE(self):
        self.send_json({"error": "use POST /api/delete"}, 405)


# --------------------------------------------------------------------------

def main():
    ensure_layout()
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://127.0.0.1:%d" % PORT
    lines = [
        "",
        "  动漫答题放映器",
        "  ------------------------------------------",
        "  放映页   %s/play" % url,
        "  上传页   %s/admin" % url,
        "  题库     %s" % QFILE,
        "  媒体     %s" % MEDIA_DIR,
        "  ------------------------------------------",
        "  停止服务: 按 Ctrl+C, 或直接关掉这个窗口",
        "",
    ]
    print("\n".join(lines))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
