"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function LandingCtaSection() {
  const router = useRouter();

  return (
    <section className="py-32 px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-t from-[#f97815]/5 to-transparent pointer-events-none"></div>
      <div className="max-w-4xl mx-auto text-center relative z-10">
        <h2 className="text-4xl md:text-5xl font-black mb-6">Ready to Simplify Your AI Infrastructure?</h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Join developers who are streamlining their AI integrations with ModelHub. Open source and free to start.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            onClick={() => router.push("/dashboard")}
            aria-label="Start free with ModelHub dashboard"
            className="w-full sm:w-auto h-14 px-10 rounded-lg bg-[#f97815] hover:bg-[#e0650a] text-[#181411] text-lg font-bold shadow-[0_0_20px_rgba(249,120,21,0.5)]"
          >
            Start Free
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open("https://github.com/decolua/modelhub#readme", "_blank")}
            aria-label="Read ModelHub documentation on GitHub"
            className="w-full sm:w-auto h-14 px-10 rounded-lg border border-[#3a2f27] hover:bg-[#23180f] text-white text-lg font-bold"
          >
            Read Documentation
          </Button>
        </div>
      </div>
    </section>
  );
}
