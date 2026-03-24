"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmailsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/pipeline");
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[200px] text-slate-500 text-sm">
      Redirection vers le Pipeline…
    </div>
  );
}
