# Boxly — QR box inventory

A small web app for people whose boxes already have QR labels on them. Scan a box,
say where it is, list what went inside — then find anything later by searching for
the thing, not the box.

No accounts, no server, no build step to run it. Everything is kept in the
browser's `localStorage` on the device you use it from.

## Running it

The camera only works in a secure context, so use one of these:

```bash
cd boxapp
python3 -m http.server 8000     # then open http://localhost:8000
```

- **On a phone** (where scanning actually happens) the page has to be served over
  `https://`. Any static host works — the whole app is four files plus two vendored
  libraries.
- **Offline / no server**: open `dist/boxly.html` directly. It is the same app
  inlined into a single file, so it runs from a USB stick or a `file://` path.
  Camera scanning stays unavailable there; typing codes and everything else works.

## What it does

**Scan** — reads the QR label through the camera. Uses the browser's native
`BarcodeDetector` when it exists and falls back to a bundled decoder everywhere
else. A code it already knows opens that box; an unknown code offers to create it.
If the camera is blocked or missing, you can type the code or read it from a photo.

**Quick-assign** — a switch on the scan screen. Set a location once, then every
scan drops that box at that location and keeps the camera running. This is the
unloading-the-van mode: twenty boxes into a storage unit without touching the
screen between scans.

**Boxes** — name, location, notes, and a list of contents. Typing `4x dinner plates`
records a quantity; commas split one line into several items. Everything saves as
you type.

**Photos** — pictures of the box, its contents, or the serial number on the back of
something. Take them with the phone camera or pick them from the library; the first
one becomes the cover shown in your box list. Files are downscaled to 1600px and
re-encoded as JPEG, and each one also gets a thumbnail so long lists stay quick.

**Search** — one field across box names, codes, locations, notes and item names.
Searching `blender` tells you which box it is in and where that box is standing.

**Locations** — boxes grouped by place, with a count of what is in each. Renaming a
place moves every box in it. Boxes with no location yet are called out at the top
so nothing gets lost.

**Labels** — printable QR stickers in three sizes for boxes that do not have one
yet, including a bulk "create ten empty boxes" button for labelling a flat stack
before you pack it. Print styles are set in millimetres and avoid breaking a label
across pages.

**Data** — JSON export/import (import merges by QR code) and a CSV of every item
for spreadsheets. Photos ride along in the JSON backup unless you untick the box.
Worth exporting before you switch phones.

## Where things are kept

Boxes, items and locations are small, so they live in `localStorage` under
`boxly.v1`. Photographs are not small — a handful of them would blow that quota and
take the inventory down with them — so the image data goes in IndexedDB
(`boxly-photos`), two blobs per photo: a 1600px version and a 320px thumbnail. The
box record only stores photo ids.

If a browser refuses IndexedDB (a sandboxed frame, some private-browsing modes), the
photo controls hide themselves and say why; everything else keeps working.

## Codes

Any QR payload works as a box code — whatever your existing stickers encode is
stored as-is. Codes that Boxly generates look like `BX-7K2QD`, drawn from an
alphabet with no `0/O` or `1/I` so they can be read aloud or typed by hand when a
label gets scuffed.

## Layout

```
index.html    markup shell
styles.css    design tokens, light + dark themes, print styles
app.js        store, router, views, scanner — no framework
fonts.css     Archivo + IBM Plex Mono embedded as data URIs
vendor/       jsQR (QR decoding), qrcode-generator (QR drawing)
build.js      inlines everything into dist/
make-fonts.js regenerates fonts.css from the upstream font packages
```

`node build.js` writes `dist/boxly.html`. Nothing else needs building.

## Licenses

Bundled third-party code and fonts keep their own licenses: jsQR (Apache-2.0),
qrcode-generator (MIT), Archivo and IBM Plex Mono (SIL Open Font License 1.1).
