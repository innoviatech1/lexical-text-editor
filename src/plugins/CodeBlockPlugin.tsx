import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { useEffect, useRef, useState } from "react";
import { mergeRegister } from "@lexical/utils";
import { CODE_BLOCK_LANGUAGES, LOW_PRIORIRTY } from "../constants";
import { useCloseToolbarOverflow } from "./toolbarOverflowContext";
import { HiChevronDown } from "react-icons/hi2";
import { IoCodeSlashOutline } from "react-icons/io5";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/common/Popover";

export default function CodeBlockPlugin() {
  const [editor] = useLexicalComposerContext();
  const closeOverflow = useCloseToolbarOverflow();
  const [isActive, setIsActive] = useState(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const updateState = () => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const isCode = $isCodeNode(element);
      setIsActive(isCode);
      if (isCode) setLanguage(element.getLanguage() ?? null);
    }
  };

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateState();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateState();
          return false;
        },
        LOW_PRIORIRTY
      )
    );
  }, [editor]);

  /**
   * Toggling to a code block requires an active range selection; a
   * never-touched editor (no caret) makes $setBlocksType a silent no-op.
   * Same issue the table had: the toolbar steals focus from the editor when
   * its buttons are clicked, so anchor a caret at the start of the first
   * paragraph before converting.
   */
  const toggleCodeBlock = (lang?: string | null) => {
    editor.update(() => {
      if (!$isRangeSelection($getSelection())) {
        const first = $getRoot().getFirstChild();
        if ($isElementNode(first)) {
          first.select(0, 0);
        }
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      if ($isCodeNode(element)) {
        $setBlocksType(selection, () => $createParagraphNode());
      } else {
        const languageToUse = lang ?? language ?? "javascript";
        $setBlocksType(selection, () => $createCodeNode(languageToUse));
      }
    });
    closeOverflow();
  };

  const applyLanguage = (lang: string) => {
    setLanguage(lang);
    editor.update(() => {
      // Selecting a language directly from normal text must ALSO create the
      // code block (standard dropdown behavior) — not just re-label an
      // existing one. Anchor a caret first for the never-focused editor case.
      if (!$isRangeSelection($getSelection())) {
        const first = $getRoot().getFirstChild();
        if ($isElementNode(first)) {
          first.select(0, 0);
        }
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      if ($isCodeNode(element)) {
        element.setLanguage(lang);
      } else {
        $setBlocksType(selection, () => $createCodeNode(lang));
      }
    });
    closeOverflow();
  };

  const activeLabel =
    CODE_BLOCK_LANGUAGES.find((l) => l.id === language)?.label ?? "Plain Text";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger triggerRef={triggerRef}>
        <button
          type="button"
          className={`lexical-btn heading-trigger ${isActive ? "toolbar-active" : "toolbar"}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          <IoCodeSlashOutline />
          <span>{activeLabel}</span>
          <HiChevronDown className={`chevron ${open ? "rotated" : ""}`} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        open={open}
        align="start"
        onClose={() => setOpen(false)}
        contentRef={contentRef}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <button
            type="button"
            className={`lexical-btn ${isActive ? "toolbar-active" : "toolbar"}`}
            onClick={() => {
              toggleCodeBlock();
              setOpen(false);
            }}
            style={{ minWidth: 150 }}
          >
            <IoCodeSlashOutline />
            <span className="label">
              {isActive ? "Remove Code Block" : "Code Block"}
            </span>
          </button>

          <div className="w-full h-[1px] bg-gray-200 my-1" />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {CODE_BLOCK_LANGUAGES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`lexical-btn ${language === id ? "toolbar-active" : "toolbar"}`}
                onClick={() => {
                  applyLanguage(id);
                  setOpen(false);
                }}
                style={{ minWidth: 150 }}
              >
                <span className="label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
