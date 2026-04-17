import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body text-sm leading-7 space-y-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold tracking-tight mt-8 mb-4 border-b pb-2 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold tracking-tight mt-8 mb-3">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-6 mb-2">{children}</h3>
          ),
          p: ({ children }) => <p className="text-[13.5px] leading-7">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 space-y-1.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1.5">{children}</ol>,
          li: ({ children }) => <li className="text-[13.5px] leading-7">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary transition-colors"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return <code className={className}>{children}</code>;
            }
            return (
              <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-[12px] font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-zinc-950 border rounded-md p-4 overflow-x-auto text-[12px] leading-6">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="text-[13px] border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-2 bg-muted font-semibold text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2">{children}</td>
          ),
          hr: () => <hr className="my-8 border-border" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
