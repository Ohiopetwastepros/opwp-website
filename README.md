# Ohio Pet Waste Pros operating website

This repository is the source of truth for the OPWP website and operating tools.

- **Source of truth:** GitHub (Ohiopetwastepros/opwp-website)
- **Staging/preview:** the Cloudflare workers.dev URL; Vercel may remain a preview/status check only
- **Production application:** Cloudflare Worker built with OpenNext
- **Public domain after cutover:** ohiopetwastepros.com
- **Legacy site:** WordPress remains live until the controlled DNS/custom-domain cutover

A successful Vercel build is not a production deployment. Production is built with
npm run build:cloudflare and deployed through the Cloudflare Worker workflow.

See CLOUDFLARE_DEPLOYMENT.md and docs/PRODUCTION_HARDENING.md before release.
