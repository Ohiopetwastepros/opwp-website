/** @type {import('next').NextConfig} */

const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");

initOpenNextCloudflareForDev();

const nextConfig = {
  // Preserve the exact WordPress URL structure (trailing slashes) so rankings transfer.
  trailingSlash: true,
  // Apply legacy mappings before the trailing-slash fallbacks.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }, {
      source: "/field/sw.js",
      headers: [{key:"Service-Worker-Allowed",value:"/field/"},{key:"Cache-Control",value:"no-cache"}],
    }, {
      source: "/field/app/:path*",
      headers: [{key:"Permissions-Policy",value:"camera=(self), geolocation=(self), microphone=(self)"},{key:"X-Robots-Tag",value:"noindex, nofollow"},{key:"Referrer-Policy",value:"no-referrer"}],
    }, {
      // Admin middleware owns these headers so global defaults cannot be
      // appended to (and weaken) its DENY / no-referrer policies.
      source: "/:path((?!field/app(?:/|$)|admin(?:/|$)|api/admin(?:/|$)|food-sales(?:/|$)|api/food-sales(?:/|$)|dog-food/account(?:/|$)|api/dog-food/(?:account|session|order)(?:/|$)).*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
  async redirects() {
    const { legacyPageRedirects, legacySectionRedirects } = await import("./lib/canonical-redirect.mjs");
    const toRule = ([source, destination]) => ({ source, destination, statusCode: 301 });
    return [
      ...legacyPageRedirects.map(toRule),
      ...legacySectionRedirects.map(([source, destination]) => toRule([source + "/:slug*", destination])),

      // Keep canonical slashes for normal pages and remove them from file URLs.
      {
        source: "/:page((?!api/|\\.well-known(?:/|$))(?:[^/]+/)*[^/\\.]+$)",
        destination: "/:page/",
        statusCode: 301,
      },
      {
        source: "/:file((?!api/|\\.well-known(?:/|$))(?:[^/]+/)*[^/]+\\.\\w+)/",
        destination: "/:file",
        statusCode: 301,
        missing: [{ type: "header", key: "x-nextjs-data" }],
      },

      // NOTE: these old URLs intentionally have NO redirect because the new site
      // keeps the exact same slug (rankings transfer 1:1):
      //   /  /residential/  /contact/  /blog/  /commercial-services/
      //   /about-our-pet-waste-removal-team/  /dog-food/
      //   /privacy-policy/  /terms-of-service/
    ];
  },
};

module.exports = nextConfig;
