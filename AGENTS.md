# Repository requirements

- Preserve source-system ownership, current pricing, authorization, and production behavior.
- Keep credentials and operational records out of public source and browser assets.
- Follow `docs/PRIVATE_BUILD_INPUTS.md`; production SQL and inputs remain private and byte-verified.
- Never substitute synthetic inputs or test schemas for production records.
- Run the dependency audit, relevant tests, production build, and whitespace checks before handoff.
- Release through `npm run deploy -- --summary "..."` only after CI and security gates pass. Do not bypass locks or guards.
- Database migrations require separate authorization and are not part of website deployment.
