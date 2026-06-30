/** @type {import('next').NextConfig} */

// --- Old WordPress blog slugs -> new (shortened) blog slugs ---
const blogRedirects = [
  ["/how-much-does-dog-poop-removal-cost-in-toledo-the-surrounding-area", "/blog/dog-poop-removal-cost-toledo"],
  ["/what-can-you-do-if-your-neighbor-doesnt-pick-up-dog-poop", "/blog/neighbor-wont-pick-up-dog-poop"],
  ["/how-do-professionals-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/how-professionals-pick-up-dog-poop"],
  ["/how-to-clean-up-large-amounts-of-dog-poop-in-toledo-the-surrounding-area", "/blog/clean-up-large-amounts-dog-poop"],
  ["/how-do-i-tell-my-neighbor-to-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/how-to-tell-neighbor-pick-up-dog-poop"],
  ["/can-you-sue-someone-for-not-picking-up-dog-poop-in-toledo-the-surrounding-area", "/blog/can-you-sue-not-picking-up-dog-poop"],
  ["/how-much-does-it-cost-to-have-someone-pick-up-dog-poop-in-your-yard-in-toledo-the-surrounding-area", "/blog/cost-dog-poop-pickup-toledo"],
  ["/can-i-leave-dog-poop-in-my-yard-in-toledo-the-surrounding-area", "/blog/can-i-leave-dog-poop-in-yard"],
  ["/what-happens-to-dog-poop-if-not-picked-up-in-toledo-the-surrounding-area", "/blog/what-happens-dog-poop-not-picked-up"],
  ["/can-i-pay-someone-to-pick-up-my-dogs-poop-in-toledo-the-surrounding-area", "/blog/can-i-pay-someone-pick-up-dog-poop"],
  ["/why-shouldnt-you-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/why-should-you-pick-up-dog-poop"],
  ["/where-do-i-dispose-of-pet-waste-in-toledo", "/blog/where-dispose-pet-waste-toledo"],
  ["/best-pet-waste-removal-services-in-perrysburg-oh", "/blog/best-pet-waste-removal-perrysburg"],
  ["/dog-poop-pickup-options-in-sylvania-oh", "/blog/dog-poop-pickup-options-sylvania"],
  ["/how-often-should-you-clean-up-dog-poop-in-your-yard", "/blog/how-often-clean-up-dog-poop"],
  ["/top-5-best-dog-parks-in-toledo-oh-perfect-spots-for-your-furry-friend", "/blog/top-5-dog-parks-toledo"],
  // No new equivalent -- consolidate into the blog index
  ["/how-much-do-people-get-paid-for-picking-up-dog-poop-in-toledo-the-surrounding-area", "/blog"],
];

// --- Old WordPress service-area pages -> new city pages ---
const cityRedirects = [
  ["/service-area-temperance-mi", "/dog-poop-removal-temperance-mi"],
  ["/service-area-lambertville-mi", "/dog-poop-removal-lambertville-mi"],
  ["/service-area-ottowa-lake-mi", "/dog-poop-removal-ottawa-lake-mi"],
  ["/service-area-holland", "/dog-poop-removal-holland-oh"],
  ["/service-area-monclova", "/dog-poop-removal-monclova-oh"],
  ["/service-area-northwood", "/dog-poop-removal-northwood-oh"],
  ["/service-area-perrysburg", "/dog-poop-removal-perrysburg-oh"],
  ["/service-area-dog-poop-removal-swanton", "/dog-poop-removal-swanton-oh"],
  ["/service-area-sylvania", "/dog-poop-removal-sylvania-oh"],
  ["/dog-poop-removal-service-area-toledo", "/dog-poop-removal-toledo-oh"],
  ["/dog-poop-removal-waterville-service-area", "/dog-poop-removal-waterville-oh"],
  ["/service-area-dog-poop-removal-rossford-rossford", "/dog-poop-removal-rossford-oh"],
  ["/service-area-maumee", "/dog-poop-removal-maumee-oh"],
  ["/service-area-bowling-green-oh", "/dog-poop-removal-bowling-green-oh"],
  ["/service-area-whitehouse", "/dog-poop-removal-whitehouse-oh"],
  ["/service-area-oregon", "/dog-poop-removal-oregon-oh"],
  // Places without a dedicated new city page -> nearest city or the service-areas hub
  ["/service-area-ottawa-hills", "/service-areas"],
  ["/service-area-point-place", "/dog-poop-removal-toledo-oh"],
  ["/service-area-bedford-township-mi", "/dog-poop-removal-temperance-mi"],
  ["/service-locations", "/service-areas"],
];

const toRule = ([source, destination]) => ({ source, destination, permanent: true });

const nextConfig = {
  // Preserve the exact WordPress URL structure (trailing slashes) so rankings transfer.
  trailingSlash: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // --- Short convenience slugs -> new canonical routes ---
      { source: "/commercial", destination: "/commercial-services", permanent: true },
      { source: "/about", destination: "/about-our-pet-waste-removal-team", permanent: true },
      { source: "/quote", destination: "/free-quote", permanent: true },

      // --- Old Sweep & Go funnel pages -> new onboarding flow ---
      { source: "/sng", destination: "/free-quote", permanent: true },
      { source: "/sng/:path*", destination: "/free-quote", permanent: true },

      // --- Blog posts (slugs were shortened on the new site) ---
      ...blogRedirects.map(toRule),

      // --- Service-area pages -> new city pages ---
      ...cityRedirects.map(toRule),

      // --- Thin / consolidated pages ---
      { source: "/reviews", destination: "/", permanent: true },
      { source: "/testimonial/:slug*", destination: "/", permanent: true },
      { source: "/category/:slug*", destination: "/blog", permanent: true },
      { source: "/author/:slug*", destination: "/about-our-pet-waste-removal-team", permanent: true },
      { source: "/ohio-pet-waste-pros-gift-cards", destination: "/contact", permanent: true },

      // NOTE: these old URLs intentionally have NO redirect because the new site
      // keeps the exact same slug (rankings transfer 1:1):
      //   /  /residential/  /contact/  /blog/  /commercial-services/
      //   /about-our-pet-waste-removal-team/  /dog-food/
      //   /privacy-policy/  /terms-of-service/
    ];
  },
};

module.exports = nextConfig;
