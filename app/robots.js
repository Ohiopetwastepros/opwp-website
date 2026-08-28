import { site } from "@/lib/site";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/office/", "/field/", "/api/"],
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
