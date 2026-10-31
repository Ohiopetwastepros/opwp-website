# OPWP website

This repository contains the website implementation and synthetic validation inputs. See [private build inputs](docs/PRIVATE_BUILD_INPUTS.md) before building or deploying.

CI installs dependencies from the lockfile, prepares synthetic inputs, audits dependencies, tests the application, and builds the Cloudflare Worker. Owner production releases use verified private inputs and the guarded deployment runner. No database migrations run during deployment.
