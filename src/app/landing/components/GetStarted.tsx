"use client";
import { useEffect, useState } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Shown until the browser tells us where this instance actually lives.
const PLACEHOLDER_ORIGIN = "https://your-modelhub.example";

const STEPS = [
  { title: "Create your account", desc: "Sign in and your workspace is ready — nothing to install." },
  { title: "Connect your providers", desc: "Add OAuth accounts or API keys from the dashboard." },
  { title: "Route requests", desc: "Point your CLI tools at your instance and keep the same OpenAI-compatible calls." },
];

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();
  const [origin, setOrigin] = useState(PLACEHOLDER_ORIGIN);

  useEffect(() => setOrigin(window.location.origin), []);

  const command = `curl ${origin}/v1/chat/completions \
  -H "Authorization: Bearer $MODELHUB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/model-id","messages":[{"role":"user","content":"Hello"}]}'`;

  return (
    <section className="py-24 px-6 bg-[#120f0d]">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Get Started in 30 Seconds</h2>
            <p className="text-gray-400 text-lg mb-8">
              Sign in, connect your providers in the web dashboard, and start routing AI requests through one endpoint.
            </p>

            <div className="flex flex-col gap-6">
              {STEPS.map((step, index) => (
                <div key={step.title} className="flex gap-4">
                  <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">{index + 1}</div>
                  <div>
                    <h4 className="font-bold text-lg">{step.title}</h4>
                    <p className="text-sm text-gray-500 mt-1">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-[#1e1e1e] border border-[#3a2f27] shadow-2xl">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#252526] border-b border-gray-700">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <div className="ml-2 text-xs text-gray-500 font-mono">terminal</div>
              </div>

              {/* Terminal content */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <div
                  className="flex items-start gap-2 mb-4 group cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label="Copy example request"
                  onClick={() => copy(command, "landing")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      copy(command, "landing");
                    }
                  }}
                >
                  <span className="text-green-400">$</span>
                  <pre className="text-white whitespace-pre">{command}</pre>
                  <span className="ml-auto pl-4 text-gray-500 text-xs opacity-0 group-hover:opacity-100">
                    {copied === "landing" ? "✓ Copied" : "Copy"}
                  </span>
                </div>

                <div className="text-gray-400 mb-6">
                  <span className="text-[#f97815]">&gt;</span> Routing to the best available provider...<br/>
                  <span className="text-[#f97815]">&gt;</span> Falling back automatically when one is rate limited<br/>
                  <span className="text-green-400">&gt;</span> Response streamed back ✓
                </div>

                <div className="text-xs text-gray-500 border-t border-gray-700 pt-4">
                  📝 API keys, provider accounts and usage all live in your dashboard
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
