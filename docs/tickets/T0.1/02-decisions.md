# T0.1 Decisions

## Why Node 20.19.3?

Nx has a known issue with the Angular dev server on certain Node versions. Using `20.19.3` is a verified workaround/fix.
Reference: [https://github.com/nrwl/nx/issues/31570](https://github.com/nrwl/nx/issues/31570)

## Why .env Enforced Early?

To prevent secrets and configuration from being hardcoded in the codebase, we are enforcing the use of `.env` files from the start. This establishes a secure baseline for future development.

## Why Default-Deny?

A default-deny security posture ensures that no endpoints are accidentally exposed. Developers must explicitly whitelist endpoints, which reduces the attack surface.

## Why No proxy.conf?

Using a proxy configuration in Angular hides the true nature of cross-origin requests during development. By enabling CORS on the API and configuring the Portal to talk directly to the API, we mirror the production environment more closely.

## Why Environment Files in Portal?

Angular's environment files are the standard way to handle build-time configuration. They allow us to specify different API URLs for development and production without changing the code.
