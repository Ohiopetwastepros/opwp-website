import { redirect } from "next/navigation";
export const metadata = {
  title: "OPWP Field",
  robots: { index: false, follow: false },
};
export default function Page() {
  redirect("/field/app/");
}
