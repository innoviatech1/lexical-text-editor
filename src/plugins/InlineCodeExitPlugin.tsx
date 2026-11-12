import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $getNodeByKey,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  type LexicalNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { useEffect } from "react";

/**
 * Inline code (toolbar "Code" / <code> text format) used to trap the user:
 * pressing Enter carried the `code` format onto every following line, so
 * each new line rendered as another gray code pill with no way back to
 * plain text.
 *
 * Standard editor behavior, provided here:
 *
 * 1. Enter at the end of a code span → the new line is plain text (Lexical
 *    would otherwise inherit the code format onto it). Splitting mid-code
 *    intentionally keeps the format on both halves.
 * 2. Typing right after a code pill (caret at the start of the text that
 *    follows it, e.g. after clicking the pill's right edge) extends the
 *    pill, like Google Docs / Notion. To type plain text after a pill, move
 *    the caret away first (ArrowRight, click further right, or use Enter).
 */
export default function InlineCodeExitPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let stripCodeOnNextUpdate = false;

    return mergeRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        () => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const node = selection.anchor.getNode();
          if (
            $isTextNode(node) &&
            node.hasFormat("code") &&
            selection.anchor.offset === node.getTextContentSize()
          ) {
            stripCodeOnNextUpdate = true;
          }
          return false; // let Lexical insert the line break as usual
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          // Printable characters only — joining the pill on the right boundary
          if (event.ctrlKey || event.metaKey || event.altKey) return false;
          const key = event.key;
          if (key.length !== 1) return false;

          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const node = selection.anchor.getNode();
          if (!$isTextNode(node) || node.hasFormat("code")) return false;
          if (selection.anchor.offset !== 0) return false;

          const prev = node.getPreviousSibling();
          if (!$isTextNode(prev) || !prev.hasFormat("code")) return false;

          // Caret sits at the right edge of a code pill — the typed character
          // continues the pill (standard boundary behavior).
          event.preventDefault();
          const codeKey = prev.getKey();
          editor.update(() => {
            const code = $getNodeByKey(codeKey);
            if (!$isTextNode(code) || !code.hasFormat("code")) return;
            code.setTextContent(code.getTextContent() + key);
            const at = code.getTextContentSize();
            code.select(at, at);
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerUpdateListener(({ editorState }) => {
        if (!stripCodeOnNextUpdate) return;
        stripCodeOnNextUpdate = false;
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          editor.update(() => {
            const latest = $getSelection();
            if (!$isRangeSelection(latest)) return;
            const node = latest.anchor.getNode();

            const isEmptyCodeNode = (n: LexicalNode | null | undefined): boolean =>
              $isTextNode(n) &&
              n.getTextContentSize() === 0 &&
              n.hasFormat("code");

            if ($isTextNode(node)) {
              if (isEmptyCodeNode(node)) {
                node.setFormat(0);
              } else {
                // Split at the end of a code span that was NOT the paragraph's
                // last child: Lexical leaves an invisible empty code-formatted
                // node right before the caret (e.g. before the moved-out tail
                // text). Clear any such empty nodes so typing continues plain.
                let prev: LexicalNode | null = node.getPreviousSibling();
                while (prev && $isTextNode(prev) && prev.getTextContentSize() === 0) {
                  if (prev.hasFormat("code")) prev.setFormat(0);
                  prev = prev.getPreviousSibling();
                }
              }
            } else if ($isElementNode(node)) {
              if (node.getChildrenSize() === 0) {
                // Fresh empty paragraph: Lexical will create the next text node
                // from the selection's format flags — clear the code bit there.
                if (latest.hasFormat("code")) {
                  latest.setFormat(0);
                }
              } else {
                const first = node.getFirstChild();
                if (isEmptyCodeNode(first) && $isTextNode(first)) first.setFormat(0);
              }
            }

            // The split also leaves the code bit on the SELECTION's format
            // flags — when the caret landed on a plain text node, Lexical uses
            // those flags to create the next typed text node. Clear them.
            if (!$isTextNode(node) || !node.hasFormat("code")) {
              if (latest.hasFormat("code")) {
                latest.setFormat(0);
              }
            }
          });
        });
      })
    );
  }, [editor]);

  return null;
}
