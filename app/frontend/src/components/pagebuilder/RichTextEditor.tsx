import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useCallback } from "react";

const PALETTE = [
  { name: "Navy",       value: "#121C2D" },
  { name: "Slate",      value: "#354052" },
  { name: "Gray 60",    value: "#606B85" },
  { name: "Red",        value: "#DB131A" },
  { name: "Blue",       value: "#0263E0" },
  { name: "Blue Light", value: "#E4F7FF" },
  { name: "White",      value: "#FFFFFF" },
  { name: "Gray 10",    value: "#F4F4F6" },
  { name: "Gray 20",    value: "#E1E3EA" },
  { name: "Success",    value: "#22C55E" },
  { name: "Warning",    value: "#F59E0B" },
  { name: "Error",      value: "#EF4444" },
];

interface Props {
  html: string;
  onChange: (html: string) => void;
  autoFocus?: boolean;
}

function ToolbarBtn({
  active, onClick, title, children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`px-1.5 py-0.5 rounded text-xs font-semibold leading-none transition-colors ${
        active
          ? "bg-[var(--twilio-blue)] text-white"
          : "text-[var(--twilio-navy)] hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ html, onChange, autoFocus }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: html,
    autofocus: autoFocus ?? false,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, false);
    }
  }, [html]);

  const setColor = useCallback(
    (color: string) => { editor?.chain().focus().setColor(color).run(); },
    [editor]
  );

  const setHighlight = useCallback(
    (color: string) => { editor?.chain().focus().toggleHighlight({ color }).run(); },
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-[#F4F4F6]">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></ToolbarBtn>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">H3</ToolbarBtn>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">"</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">{"`"}</ToolbarBtn>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">⬅</ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">⬌</ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">➡</ToolbarBtn>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        {/* Text color swatches */}
        <span className="text-[10px] text-[var(--twilio-gray-60)] mr-0.5">A</span>
        {PALETTE.map((c) => (
          <button
            key={"tc-" + c.value}
            onMouseDown={(e) => { e.preventDefault(); setColor(c.value); }}
            title={`Text: ${c.name}`}
            className="h-4 w-4 rounded-full border border-gray-300 hover:scale-125 transition-transform shrink-0"
            style={{ background: c.value }}
          />
        ))}
        <span className="w-px h-4 bg-gray-200 mx-1" />
        {/* Highlight swatches */}
        <span className="text-[10px] text-[var(--twilio-gray-60)] mr-0.5">HL</span>
        {PALETTE.map((c) => (
          <button
            key={"hl-" + c.value}
            onMouseDown={(e) => { e.preventDefault(); setHighlight(c.value); }}
            title={`Highlight: ${c.name}`}
            className="h-4 w-4 rounded-sm border border-gray-300 hover:scale-125 transition-transform shrink-0"
            style={{ background: c.value }}
          />
        ))}
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2 min-h-[80px] focus:outline-none text-sm text-[var(--twilio-navy)]"
      />
    </div>
  );
}
