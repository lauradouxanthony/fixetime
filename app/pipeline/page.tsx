import { redirect } from "next/navigation";

// /pipeline → /emails (alias permanent)
export default function PipelinePage() {
  redirect("/emails");
}
