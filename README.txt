LAAR INSTITUTE MANAGEMENT SYSTEM — FINAL NETLIFY BUILD
======================================================

This build fixes both previously reported problems:
1. Frontend: "login is not a function"
2. Netlify build: "Could not resolve jsonwebtoken"

There is NO jsonwebtoken dependency in this build.

Login
-----
Username: litprincicpal
Password: lit2026

Netlify deployment
------------------
This project must be deployed through the GitHub-connected Netlify project.

Repository files:
  netlify.toml
  package.json
  public/index.html
  netlify/functions/api.mjs

Netlify automatically detects api.mjs as the "api" Function.

Optional environment variables:
  PRINCIPAL_USERNAME = litprincicpal
  PRINCIPAL_PASSWORD = lit2026

Health check after publishing:
  https://YOUR-SITE.netlify.app/api/health

Expected:
  {"ok":true,"service":"LIT Management API"}

Do not use Netlify Drop after connecting the GitHub repository.
Commit/push the files to main and let Netlify publish automatically.
