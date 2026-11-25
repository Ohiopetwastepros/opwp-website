import { site } from "./site.js";

export const SITE_ORIGIN = site.url;
const APEX_HOST = "ohiopetwastepros.com";
const SITE_HOST = new URL(SITE_ORIGIN).hostname;

// --- Old WordPress blog slugs -> new (shortened) blog slugs ---
const blogRedirects = [
  ["/how-much-does-dog-poop-removal-cost-in-toledo-the-surrounding-area", "/blog/dog-poop-removal-cost-toledo/"],
  ["/what-can-you-do-if-your-neighbor-doesnt-pick-up-dog-poop", "/blog/neighbor-wont-pick-up-dog-poop/"],
  ["/how-do-professionals-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/how-professionals-pick-up-dog-poop/"],
  ["/how-to-clean-up-large-amounts-of-dog-poop-in-toledo-the-surrounding-area", "/blog/clean-up-large-amounts-dog-poop/"],
  ["/how-do-i-tell-my-neighbor-to-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/how-to-tell-neighbor-pick-up-dog-poop/"],
  ["/can-you-sue-someone-for-not-picking-up-dog-poop-in-toledo-the-surrounding-area", "/blog/can-you-sue-not-picking-up-dog-poop/"],
  ["/how-much-does-it-cost-to-have-someone-pick-up-dog-poop-in-your-yard-in-toledo-the-surrounding-area", "/blog/cost-dog-poop-pickup-toledo/"],
  ["/can-i-leave-dog-poop-in-my-yard-in-toledo-the-surrounding-area", "/blog/can-i-leave-dog-poop-in-yard/"],
  ["/what-happens-to-dog-poop-if-not-picked-up-in-toledo-the-surrounding-area", "/blog/what-happens-dog-poop-not-picked-up/"],
  ["/can-i-pay-someone-to-pick-up-my-dogs-poop-in-toledo-the-surrounding-area", "/blog/can-i-pay-someone-pick-up-dog-poop/"],
  ["/why-shouldnt-you-pick-up-dog-poop-in-toledo-the-surrounding-area", "/blog/why-should-you-pick-up-dog-poop/"],
  ["/where-do-i-dispose-of-pet-waste-in-toledo", "/blog/where-dispose-pet-waste-toledo/"],
  ["/best-pet-waste-removal-services-in-perrysburg-oh", "/blog/best-pet-waste-removal-perrysburg/"],
  ["/dog-poop-pickup-options-in-sylvania-oh", "/blog/dog-poop-pickup-options-sylvania/"],
  ["/how-often-should-you-clean-up-dog-poop-in-your-yard", "/blog/how-often-clean-up-dog-poop/"],
  ["/top-5-best-dog-parks-in-toledo-oh-perfect-spots-for-your-furry-friend", "/blog/top-5-dog-parks-toledo/"],
  // No new equivalent -- consolidate into the blog index
  ["/how-much-do-people-get-paid-for-picking-up-dog-poop-in-toledo-the-surrounding-area", "/blog/"],
];

// --- Old WordPress service-area pages -> new city pages ---
const cityRedirects = [
  ["/service-area-temperance-mi", "/dog-poop-removal-temperance-mi/"],
  ["/service-area-lambertville-mi", "/dog-poop-removal-lambertville-mi/"],
  ["/service-area-ottowa-lake-mi", "/dog-poop-removal-ottawa-lake-mi/"],
  ["/service-area-holland", "/dog-poop-removal-holland-oh/"],
  ["/service-area-monclova", "/dog-poop-removal-monclova-oh/"],
  ["/service-area-northwood", "/dog-poop-removal-northwood-oh/"],
  ["/service-area-perrysburg", "/dog-poop-removal-perrysburg-oh/"],
  ["/service-area-dog-poop-removal-swanton", "/dog-poop-removal-swanton-oh/"],
  ["/service-area-sylvania", "/dog-poop-removal-sylvania-oh/"],
  ["/dog-poop-removal-service-area-toledo", "/dog-poop-removal-toledo-oh/"],
  ["/dog-poop-removal-waterville-service-area", "/dog-poop-removal-waterville-oh/"],
  ["/service-area-dog-poop-removal-rossford-rossford", "/dog-poop-removal-rossford-oh/"],
  ["/service-area-maumee", "/dog-poop-removal-maumee-oh/"],
  ["/service-area-bowling-green-oh", "/dog-poop-removal-bowling-green-oh/"],
  ["/service-area-whitehouse", "/dog-poop-removal-whitehouse-oh/"],
  ["/service-area-oregon", "/dog-poop-removal-oregon-oh/"],
  // Places without a dedicated new city page -> nearest city or the service-areas hub
  ["/service-area-ottawa-hills", "/service-areas/"],
  ["/service-area-point-place", "/dog-poop-removal-toledo-oh/"],
  ["/service-area-bedford-township-mi", "/dog-poop-removal-temperance-mi/"],
  ["/service-locations", "/service-areas/"],
];

export const legacyPageRedirects = [
  ["/commercial", "/commercial-services/"],
  ["/about", "/about-our-pet-waste-removal-team/"],
  ["/quote", "/free-quote/"],
  ["/reviews", "/"],
  ["/ohio-pet-waste-pros-gift-cards", "/contact/"],
  ...blogRedirects,
  ...cityRedirects,
];

export const legacySectionRedirects = [
  ["/sng", "/free-quote/"],
  ["/testimonial", "/"],
  ["/category", "/blog/"],
  ["/author", "/about-our-pet-waste-removal-team/"],
];

const legacyPages = new Map(legacyPageRedirects);
const reservedPrefix = /^(?:\/api|\/_next|\/\.well-known|\/cdn-cgi)(?:\/|$)/i;
const feedPath = /\/feed(?:\/(?:rss2?|atom|rdf))?\/?$/i;
const slashlessPage = /\/[^/.]+$/;
const slashedFile = /\/[^/]+\.\w+\/$/;

export function canonicalRedirect(request) {
  const url = new URL(request.url);
  const apex = url.hostname === APEX_HOST;
  if (!apex && url.hostname !== SITE_HOST) return null;

  const { pathname } = url;
  if (["GET", "HEAD"].includes(request.method) && !reservedPrefix.test(pathname)) {
    // Feed URLs must take precedence over legacy section redirects, including /category/.
    if (feedPath.test(pathname)) {
      if (!apex) return new Response(null, { status: 410 });
    } else {
      const legacyPath = pathname.replace(/\/$/, "").toLowerCase();
      const section = legacySectionRedirects.find(([prefix]) => legacyPath === prefix || legacyPath.startsWith(prefix + "/"));
      const destination = legacyPages.get(legacyPath) ?? section?.[1];
      if (destination) url.pathname = destination;
      else if (slashlessPage.test(pathname)) url.pathname = pathname + "/";
      else if (slashedFile.test(pathname) && !request.headers.has("x-nextjs-data")) url.pathname = pathname.slice(0, -1);
    }
  }

  if (!apex && url.pathname === pathname) return null;
  url.protocol = "https:";
  url.hostname = SITE_HOST;
  url.port = "";
  return Response.redirect(url, 301);
}
