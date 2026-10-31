import WorkdayApp from "./WorkdayApp";
export const metadata = {
  title: "Technician workday",
  robots: { index: false, follow: false, nocache: true },
  manifest: "/field-app/manifest.webmanifest",
  alternates: { canonical: "/field/app/" },
};
export const viewport = { themeColor: "#1F4566" };
// Public application shell only. All customer/route data comes from authenticated no-store APIs.
export default function Page() {
  return <WorkdayApp />;
}
