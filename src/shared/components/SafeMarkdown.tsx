import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const SAFE_MARKDOWN_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "strong", "table",
    "tbody", "td", "th", "thead", "tr", "ul",
  ],
  attributes: {
    a: ["href", "title"],
    code: [["className", /^language-[\w-]+$/]],
    th: ["align"],
    td: ["align"],
  },
  protocols: {
    href: ["http", "https", "mailto"],
  },
};

function safeUrlTransform(url: string): string {
  const value = url.trim();
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? value : "";
  } catch {
    return "";
  }
}

function SafeLink({ href = "", children, ...props }: ComponentProps<"a">) {
  const isExternal = /^https?:\/\//i.test(href);
  return (
    <a
      {...props}
      href={href}
      rel={isExternal ? "nofollow noopener noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    >
      {children}
    </a>
  );
}

interface SafeMarkdownProps {
  source: string;
  className?: string;
}

export default function SafeMarkdown({ source, className }: SafeMarkdownProps) {
  return (
    <div className={cn("break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SAFE_MARKDOWN_SCHEMA]]}
        urlTransform={safeUrlTransform}
        components={{ a: SafeLink }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
