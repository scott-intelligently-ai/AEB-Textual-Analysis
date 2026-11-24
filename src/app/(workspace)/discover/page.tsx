import { redirect } from "next/navigation";

export default function Page() {
  redirect("/terms?discover=1");
}
