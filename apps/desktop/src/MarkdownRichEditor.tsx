import Link from "@tiptap/extension-link";
import HardBreak from "@tiptap/extension-hard-break";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension, type Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef } from "react";
import { InlineStyleMark } from "./InlineStyleMark";
import { createRichEditorSync } from "./richEditorSync";

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

const SingleLineHardBreak = HardBreak.extend({
  renderMarkdown: () => "\n",
});

const EnterLineBreaks = Extension.create({
  name: "enterLineBreaks",
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (
          !selection.empty ||
          selection.$from.parent.type.name !== "paragraph" ||
          this.editor.isActive("blockquote") ||
          this.editor.isActive("listItem") ||
          this.editor.isActive("taskItem") ||
          this.editor.isActive("codeBlock")
        ) {
          return false;
        }

        if (selection.$from.nodeBefore?.type.name === "hardBreak") {
          return this.editor
            .chain()
            .deleteRange({ from: selection.from - 1, to: selection.from })
            .splitBlock()
            .command(({ tr, dispatch }) => {
              if (dispatch) tr.setStoredMarks([]);
              return true;
            })
            .run();
        }

        return this.editor.commands.setHardBreak();
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
  contentRef.current = content;
  const syncRef = useRef<ReturnType<typeof createRichEditorSync> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        hardBreak: false,
        link: false,
      }),
      SingleLineHardBreak,
      EnterLineBreaks,
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
        markedOptions: { gfm: true, breaks: true },
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
        handleDOMEvents: {
          compositionstart: () => {
            syncRef.current?.startComposition();
            return false;
          },
          compositionend: () => {
            syncRef.current?.endComposition();
            return false;
          },
        },
      },
      extensions,
      onUpdate: () => {
        syncRef.current?.update();
      },
    },
    [extensions, ariaLabel],
  );

  useEffect(() => {
    if (!editor) return;

    const sync = createRichEditorSync(contentRef.current, {
      getContent: () => getMarkdown(editor),
      replaceContent: (nextContent) => {
        editor.commands.setContent(keepDeepHeadingsLiteral(nextContent), {
          contentType: "markdown",
          emitUpdate: false,
        });
      },
      onChange: (nextContent) => onChangeRef.current(nextContent),
      isComposing: () => editor.view.composing,
    });
    syncRef.current = sync;

    return () => {
      sync.dispose();
      syncRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    syncRef.current?.sync(content);
  }, [content, editor]);

  useEffect(() => {
    if (className !== "widget-markdown-editor") return;

    const container = containerRef.current;
    if (!container) return;

    const updateScrollbarHover = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const scrollbarStart = bounds.left + container.clientLeft + container.clientWidth;
      const overScrollbar =
        container.scrollHeight > container.clientHeight &&
        event.clientX >= scrollbarStart &&
        event.clientX < bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY < bounds.bottom;

      container.classList.toggle("scrollbar-hovered", overScrollbar);
    };
    const clearScrollbarHover = () => {
      container.classList.remove("scrollbar-hovered");
    };

    document.addEventListener("pointermove", updateScrollbarHover, true);
    document.documentElement.addEventListener("pointerleave", clearScrollbarHover);
    window.addEventListener("blur", clearScrollbarHover);

    return () => {
      document.removeEventListener("pointermove", updateScrollbarHover, true);
      document.documentElement.removeEventListener("pointerleave", clearScrollbarHover);
      window.removeEventListener("blur", clearScrollbarHover);
    };
  }, [className]);

  return (
    <div
      ref={containerRef}
      className={`markdown-rich-editor ${className}`}
      onClick={() => editor?.chain().focus().run()}
    >
      <EditorContent editor={editor} id={editorId} />
    </div>
  );
}
