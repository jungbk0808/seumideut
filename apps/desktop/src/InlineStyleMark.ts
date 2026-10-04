import { Mark } from "@tiptap/core";

const STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration-line",
] as const;
const STYLEABLE_TAGS = new Set([
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "mark",
  "small",
  "sub",
  "sup",
  "a",
  "code",
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "ul",
  "ol",
]);

function isSafeColor(value: string) {
  return (
    value.length <= 100 &&
    !/[<>"'\\;]|url\s*\(|var\s*\(/i.test(value) &&
    CSS.supports("color", value)
  );
}

function isSafeFontSize(value: string) {
  const match = /^(\d+(?:\.\d+)?)(px|rem|em|%)$/.exec(value);
  if (!match) return false;

  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "px") return amount >= 8 && amount <= 72;
  if (unit === "%") return amount >= 50 && amount <= 400;
  return amount >= 0.5 && amount <= 4;
}

function sanitizeInlineStyle(element: HTMLElement) {
  const safeDeclarations: string[] = [];

  for (const property of STYLE_PROPERTIES) {
    const value = (
      element.style.getPropertyValue(property) ||
      (property === "text-decoration-line"
        ? element.style.getPropertyValue("text-decoration")
        : "")
    ).trim();
    if (!value) continue;

    const safe =
      ((property === "color" || property === "background-color") &&
        isSafeColor(value)) ||
      (property === "font-size" && isSafeFontSize(value)) ||
      (property === "font-weight" &&
        /^(normal|bold|[1-9]00)$/.test(value)) ||
      (property === "font-style" && /^(normal|italic|oblique)$/.test(value)) ||
      (property === "text-decoration-line" &&
        /^(none|underline|overline|line-through)( (underline|overline|line-through))*$/.test(
          value,
        ));

    if (safe) safeDeclarations.push(`${property}: ${value}`);
  }

  return safeDeclarations.join("; ");
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export const InlineStyleMark = Mark.create({
  name: "inlineStyle",

  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => sanitizeInlineStyle(element),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "*[style]",
        priority: 1000,
        consuming: false,
        getAttrs: (element) => {
          const htmlElement = element as HTMLElement;
          return STYLEABLE_TAGS.has(htmlElement.tagName.toLowerCase()) &&
            sanitizeInlineStyle(htmlElement)
            ? {}
            : false;
        },
      },
    ];
  },

  renderHTML({ mark }) {
    return ["span", { style: mark.attrs.style }, 0];
  },

  renderMarkdown(node, helpers) {
    const style = escapeHtmlAttribute(node.attrs?.style ?? "");
    return `<span style="${style}">${helpers.renderChildren(node)}</span>`;
  },
});
