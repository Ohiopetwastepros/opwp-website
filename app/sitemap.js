import { posts } from "@/data/blog";
import { cities } from "@/data/cities";
import { site } from "@/lib/site";

const staticRoutes = [
  "",
  "/residential",
  "/service-areas",
  "/dog-food",
  "/about-our-pet-waste-removal-team",
  "/blog",
  "/contact",
  "/free-quote",
  "/weekly-dog-poop-removal",
  "/bi-weekly-dog-poop-removal",
  "/one-time-yard-cleanup",
  "/yard-sanitizing-deodorizing",
  "/commercial-services",
  "/privacy-policy",
  "/terms-of-service",
];

const sitemapEntry = (path, changeFrequency, priority) => ({
  url: `${site.url}${path}/`,
  changeFrequency,
  priority,
});

export default function sitemap() {
  return [
    ...staticRoutes.map((path) =>
      sitemapEntry(path, path === "" ? "weekly" : "monthly", path === "" ? 1 : 0.8),
    ),
    ...cities.map(({ slug }) => sitemapEntry(`/${slug}`, "monthly", 0.7)),
    ...posts.map(({ slug }) => sitemapEntry(`/blog/${slug}`, "monthly", 0.6)),
  ];
}
