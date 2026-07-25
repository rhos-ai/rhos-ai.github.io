# Public Page Metadata

- Every deployable public HTML page must include canonical, Open Graph, and Twitter Card metadata.
- Use absolute `https://rhos.ai/` URLs for canonical and social metadata. Do not use the `www` host.
- Social preview images must be public raster assets in JPEG, PNG, or WebP format. Do not use SVG.
- Prefer a 1200 x 630 image under 1 MB and declare `og:image:type`, `og:image:width`, and `og:image:height`.
- Define `twitter:image` explicitly, even when it matches `og:image`.
- Keep social titles between 30 and 60 characters when practical.
- Run `npm run check` after changing public page metadata or social assets.
