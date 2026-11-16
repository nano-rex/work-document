#!/usr/bin/env python3
"""Build the encrypted Work Documents site into upload-to-netlify/.

    python3 build.py                 # asks for the password
    WD_PASSWORD='...' python3 build.py

Every page in src/pages/ is encrypted with AES-256-GCM. The key is derived
from the password with PBKDF2-SHA256. Images in src/img/ are embedded into the
encrypted pages via {{img:name.png}}. Only ciphertext, small unlock stubs and
public code end up in upload-to-netlify/. Upload only that folder to Netlify.

Requires: python3 -m pip install cryptography
"""
import base64
import getpass
import json
import mimetypes
import os
import re
import shutil
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
PUBLIC = ROOT / "public"
DIST = ROOT / "upload-to-netlify"
ITERATIONS = 600_000
MIN_PASSWORD_LEN = 12

STUB = """<!doctype html>
<html lang="en" data-page="{page}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Work Documents</title>
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="assets/app.css">
</head>
<body>
<main class="lock" hidden>
  <form id="unlock" class="lock-card">
    <h1>Work Documents</h1>
    <p>Enter the password to continue.</p>
    <input id="pw" type="password" autocomplete="current-password" aria-label="Password" required>
    <button class="btn btn-primary" type="submit">Unlock</button>
    <p id="msg" class="lock-msg" role="status"></p>
  </form>
</main>
<script src="assets/lock.js"></script>
</body>
</html>
"""


def get_password() -> str:
    pw = os.environ.get("WD_PASSWORD")
    if not pw:
        pw = getpass.getpass("New site password: ")
        if pw != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match.")
    if len(pw) < MIN_PASSWORD_LEN:
        sys.exit(f"Use at least {MIN_PASSWORD_LEN} characters (a few random words works well).")
    return pw


def embed_images(html: str) -> str:
    def repl(m):
        path = SRC / "img" / m.group(1)
        if not path.is_file():
            sys.exit(f"Missing image: {path}")
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    return re.sub(r"\{\{img:([\w.\-]+)\}\}", repl, html)


def main():
    password = get_password()
    salt = os.urandom(16)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=ITERATIONS).derive(password.encode())
    aes = AESGCM(key)

    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(PUBLIC, DIST)
    (DIST / "p").mkdir()
    (DIST / "vault.json").write_text(json.dumps({
        "v": 1, "kdf": "PBKDF2-SHA256", "iterations": ITERATIONS,
        "salt": base64.b64encode(salt).decode()}))

    pages = sorted(p.stem for p in (SRC / "pages").glob("*.html"))
    for page in pages:
        html = embed_images((SRC / "pages" / f"{page}.html").read_text(encoding="utf-8"))
        iv = os.urandom(12)
        ct = aes.encrypt(iv, html.encode("utf-8"), page.encode())
        (DIST / "p" / f"{page}.enc").write_bytes(iv + ct)
        (DIST / f"{page}.html").write_text(STUB.format(page=page), encoding="utf-8")
        print(f"  {page:14s} {len(ct) // 1024:5d} KB encrypted")

    # Safety check: nothing from src/ may reach dist/ unencrypted.
    leaks = []
    secrets = [p.read_bytes() for p in (SRC / "img").iterdir()]
    for f in DIST.rglob("*"):
        if f.is_file() and f.suffix != ".enc":
            data = f.read_bytes()
            if any(s[:256] in data for s in secrets) or b"NRIC" in data:
                leaks.append(f)
    if leaks:
        shutil.rmtree(DIST)
        sys.exit(f"Refusing to build: plaintext content found in {leaks}")

    print(f"Built {len(pages)} pages into {DIST}. Upload that folder to Netlify, or commit + push to publish on GitHub Pages.")


if __name__ == "__main__":
    main()
