#!/usr/bin/env python3
"""Generate /album/<name>/index.html bootstraps from one template. Anonymous:
album names are used ONLY in URL/title/OG, never as visible page text."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALBUMS = ["tahoe","cdmxye","playa","pdt","splash","kyoto","tokyo","sapporo","pv","cdmx","oax","bali","japan"]

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#F1ECE1" />
  <title>phanny — photo dump</title>
  <meta name="description" content="A small, ongoing archive of film photos — light, travel, and the in-between." />
  <meta property="og:title" content="phanny — photo dump" />
  <meta property="og:description" content="A small, ongoing archive of film photos — light, travel, and the in-between." />
  <meta property="og:image" content="https://lexphan.com/images/{name}/cover.jpg" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://lexphan.com/album/{name}/" />
  <link rel="icon" type="image/svg+xml" href="/assets/phanny-favicon.svg" />
  <link rel="stylesheet" href="/app.css" />
</head>
<body data-album="{name}">
{body}
  <script src="/vendor/gsap.min.js"></script>
  <script src="/vendor/ScrollTrigger.min.js"></script>
  <script src="/vendor/Flip.min.js"></script>
  <script src="/vendor/lenis.min.js"></script>
  <script src="/vendor/curtains.umd.min.js"></script>
  <script src="/album-aspects.js"></script>
  <script src="/app.js"></script>
  <script type="module" src="/orbit.js"></script>
</body>
</html>
"""

def body_inner():
    """The <body> inner HTML shared with index.html — read it back from index.html so
    there is ONE source of truth (everything between <body> and the first <script>)."""
    html = open(os.path.join(ROOT, "index.html")).read()
    start = html.index(">", html.index("<body")) + 1
    end = html.index("<script", start)
    return html[start:end].rstrip()

def main():
    body = body_inner()
    for name in ALBUMS:
        d = os.path.join(ROOT, "album", name)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w").write(TEMPLATE.format(name=name, body=body))
    print("generated", len(ALBUMS), "album bootstraps")

if __name__ == "__main__":
    main()
