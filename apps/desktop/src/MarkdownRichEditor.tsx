import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension, type Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef } from "react";
import { InlineStyleMark } from "./InlineStyleMark";

type MarkdownRichEditorProps = {
  ariaLabel?: string;
  className?: string;
  content: string;
  editorId?: string;
  onChange: (content: string) => void;
  placeholder?: string;
};

function isSafeLinkUri(uri: string) {
  try {
    const parsed = new URL(uri, window.location.origin);

    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getMarkdown(editor: Editor) {
  return editor.getMarkdown();
}

function keepDeepHeadingsLiteral(content: string) {
  return content.replace(/^#{5,6}(?=[ \t]|$)/gm, "\\$&");
}

const ExitBlockquoteOnEnter = Extension.create({
  name: "exitBlockquoteOnEnter",
  // Handle Enter before StarterKit splits a new paragraph inside the quote.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isActive("blockquote")) return false;

        return this.editor.chain().splitBlock().lift("blockquote").run();
      },
    };
  },
});

export function MarkdownRichEditor({
  ariaLabel = "메모 본문",
  className = "",
  content,
  editorId,
  onChange,
  placeholder = "여기에 바로 메모를 입력하세요.",
}: MarkdownRichEditorProps) {
  const contentRef = useRef(content);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: false,
      }),
      ExitBlockquoteOnEnter,
      InlineStyleMark,
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        enableClickSelection: true,
        isAllowedUri: (uri) => isSafeLinkUri(uri),
        linkOnPaste: true,
        markdownLinks: true,
        openOnClick: false,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        indentation: {
          style: "space",
          size: 2,
        },
      }),
    ],
    [placeholder],
  );

  const editor = useEditor(
    {
      content: keepDeepHeadingsLiteral(content),
      contentType: "markdown",
      editorProps: {
        attributes: {
          "aria-label": ariaLabel,
          class: "markdown-rich-surface",
          spellcheck: "false",
        },
      },
      extensions,
      onUpdate: ({ editor: updatedEditor }) => {
        const nextContent = getMarkdown(updatedEditor);

        contentRef.current = nextContent;
        onChangeRef.current(nextContent);
      },
    },
    [extensions, ariaLabel],
  );

  useEffect(() => {
    if (!editor || content === contentRef.current) return;

    const currentContent = getMarkdown(editor);
    if (content === currentContent) {
      contentRef.current = content;
      return;
    }

    contentRef.current = content;
    editor.commands.setContent(keepDeepHeadingsLiteral(content), {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [content, editor]);

  return (
    <div
      className={`markdown-rich-editor ${className}`}
      onClick={() => editor?.chain().focus().run()}
    >
      <EditorContent editor={editor} id={editorId} />
    </div>
  );
}
