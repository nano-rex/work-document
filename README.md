# Work Documents (work-document.netlify.app)

Fill-in documents for Demax Renovation: 7-Eleven work status photo, Giant work
permit and quotation. Each page exports to **PDF**, **image** and **print**.

## How it is protected

The live site contains **no readable content**. Every page, including the worker
list with NRIC/passport numbers, the company stamp and the signature, is encrypted
with AES-256-GCM before upload. The key is derived from the site password
(PBKDF2-SHA256, 600,000 rounds). Visitors see a password box. After unlocking, the
key is kept only for that browser tab. Closing the tab or pressing **Lock** forgets it.

Anyone with the password can read everything, so share it only with staff who need
it. To revoke access, rebuild with a new password and upload again.

## Folder layout

| Path | What | Upload? |
|---|---|---|
| `src/pages/*.html` | The real pages: edit these (workers, companies, vehicles…) | **Never** |
| `src/img/` | Logos, stamp, signature (embedded into the encrypted pages) | **Never** |
| `public/` | Shared CSS/JS, security headers, URL rules (not secret) | via build |
| `build.py` | Encrypts `src/` + copies `public/` into `upload-to-netlify/` | no |
| `.github/workflows/pages.yml` | Publishes `upload-to-netlify/` to GitHub Pages on push | no |
| `upload-to-netlify/` | **The only folder you upload** | **Yes** |

## Update the site

```bash
cd ~/github/work-document.netlify.app
python3 build.py            # asks for the password (min. 12 characters)
```

Then in Netlify: **Sites → work-document → Deploys**, and drag the
`upload-to-netlify` folder onto the deploy drop zone.

### GitHub Pages

The same encrypted build is also published at
<https://nano-rex.github.io/work-document/> from this repo. After building, commit
and push; the **Deploy to GitHub Pages** workflow publishes `upload-to-netlify/`
as-is (nothing is built or decrypted on GitHub, and it refuses to run if `src/`
is ever committed).

```bash
git add -A && git commit -m "Update documents" && git push
```

`src/` is in `.gitignore` and must never be committed: the repo is public and only
the ciphertext in `upload-to-netlify/p/` may hold document content. GitHub Pages
ignores `_headers`/`_redirects` (Netlify only), so it lacks those extra security
headers, but the content is just as encrypted.

Every build must use the password you want people to type. Building with a new
password changes it for everyone.

## Editing tips

- Worker list: `WORKERS` in `src/pages/giant_permit.html`
- Recipient companies: `COMPANIES` in `src/pages/quotation.html`
- 7-Eleven job scopes: the `scopeList` datalist in `src/pages/7eleven.html`
- Images: put the file in `src/img/` and reference it as `{{img:file.png}}`

## Layout

Documents are laid out once on a fixed A4 sheet. On screen the sheet scales to fit
(**Fit**) or shows at real size (**100%**), so it looks the same on any phone or
computer, and PDF, image and print come out at A4 size. The 7-Eleven page draws the
status box onto the photo itself, scaled to the photo, so the saved image matches
the preview for any photo size or orientation.
