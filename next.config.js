/** @type {import('next').NextConfig} */
const nextConfig = {
  // Preserve the exact WordPress URL structure (trailing slashes) so rankings transfer.
  trailingSlash: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // --- Old WordPress slugs -> new canonical routes ---
      { source: "/commercial", destination: "/commercial-services", permanent: true },
      { source: "/about", destination: "/about-our-pet-waste-removal-team", permanent: true },
      { source: "/quote", destination: "/free-quote", permanent: true },

      // --- Old Sweep & Go funnel pages -> new onboarding flow ---
      { source: "/sng", destination: "/free-quote", permanent: true },
      { source: "/sng/:path*", destination: "/free-quote", permanent: true },

      // --- Thin / consolidated pages ---
      { source: "/testimonial/:slug*", destination: "/", permanent: true },
      { source: "/category/:slug*", destination: "/blog", permanent: true },
      { source: "/author/:slug*", destination: "/about-our-pet-waste-removal-team", permanent: true },
    ];
  },
};

module.exports = nextConfig;
