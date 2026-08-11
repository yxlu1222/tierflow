/*
Copyright (C) 2023-2026 TierFlow
*/
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
  // rehypeRaw 会把内容里的原始 HTML 注入渲染;这里先用 DOMPurify 裁剪危险标签/
  // 属性(<script>、onerror、javascript: 等),封堵 XSS。markdown 语法本身是纯文本,
  // 不受影响;markdown 链接的 URL 由 react-markdown 的 defaultUrlTransform 另行清洗。
  const safe = DOMPurify.sanitize(children ?? '')
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none',
        'prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg',
        'prose-p:leading-relaxed prose-p:my-2',
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        'prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-muted prose-pre:border',
        'prose-blockquote:border-l-primary prose-blockquote:bg-muted/50 prose-blockquote:py-1',
        'prose-ul:my-2 prose-ol:my-2 prose-li:my-1',
        'prose-table:border prose-thead:bg-muted',
        'prose-td:border prose-th:border prose-td:px-3 prose-th:px-3',
        'prose-img:rounded-lg prose-img:shadow-sm',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        '[overflow-wrap:anywhere] break-words',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // 自定义组件渲染（可选）
          a: ({ node, ...props }) => (
            <a {...props} target='_blank' rel='noopener noreferrer' />
          ),
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  )
}
