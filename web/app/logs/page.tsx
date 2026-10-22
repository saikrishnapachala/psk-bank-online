import { redirect } from "next/navigation";

export default function LogsPage() {
  redirect("/debug?tab=logs");
}
