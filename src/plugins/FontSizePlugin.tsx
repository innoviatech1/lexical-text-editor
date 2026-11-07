import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, SELECTION_CHANGE_COMMAND } from 'lexical';
import { $patchStyleText, $getSelectionStyleValueForProperty } from '@lexical/selection'
import { useEffect, useState } from 'react';
import { mergeRegister } from '@lexical/utils';
import { LOW_PRIORIRTY } from '../constants';
import TooltipX from "../components/common/Tooltip";
import { LuMinus, LuPlus } from 'react-icons/lu';

const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 90;
/** Size applied when the selection has no explicit font-size yet. */
const DEFAULT_BASE_SIZE = 16;

export default function FontSizePlugin() {
  const [editor] = useLexicalComposerContext();
  const [fontSize, setFontSize] = useState("");

  const updateToolbar = () => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // 1. explicit inline style on the selection (empty string when none/mixed)
      const explicit = normalizeFontSize(
        $getSelectionStyleValueForProperty(selection, "font-size", "")
      );
      // 2. fall back to the REAL rendered size of the anchor node (theme
      //    default, heading rules, or inherited from surrounding text)
      let effective = explicit;
      if (!effective) {
        try {
          const dom = editor.getElementByKey(selection.anchor.getNode().getKey());
          if (dom) {
            effective = window.getComputedStyle(dom).fontSize || "";
          }
        } catch {
          /* detached selection → keep last known value */
        }
      }
      setFontSize(normalizeFontSize(effective))
    }
  }
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar()
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        LOW_PRIORIRTY
      ),
    )
  }, [editor])

  /**
   * Applies an explicit px size to the selection (clamped to 6-90).
   * Note: `updateToolbar` refreshes the display through the update listener.
   */
  const applyFontSize = (size: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { 'font-size': `${clamped}px` });
      }
    });
  };

  /**
   * +/- stepper: steps ±1px from the selection's current explicit size.
   * A selection without an explicit size starts from the default base.
   */
  const stepFontSize = (delta: number) => {
    const current = Number.parseInt(fontSize, 10);
    const base = Number.isNaN(current) ? DEFAULT_BASE_SIZE : current;
    applyFontSize(base + delta);
  };

  const displayedSize = Number.parseInt(fontSize, 10);
  const currentSize = Number.isNaN(displayedSize) ? null : displayedSize;

  return (
    <div className="lexical-stepper" aria-label="Font Size" role="group">
      <TooltipX content="Decrease font size" direction="bottom">
        <button
          type="button"
          aria-label="Decrease Font Size"
          className="lexical-stepper-btn"
          disabled={currentSize !== null && currentSize <= MIN_FONT_SIZE}
          onClick={() => stepFontSize(-1)}
        >
          <LuMinus />
        </button>
      </TooltipX>
      <span className="lexical-stepper-value">
        {currentSize ?? "—"}
      </span>
      <TooltipX content="Increase font size" direction="bottom">
        <button
          type="button"
          aria-label="Increase Font Size"
          className="lexical-stepper-btn"
          disabled={currentSize !== null && currentSize >= MAX_FONT_SIZE}
          onClick={() => stepFontSize(+1)}
        >
          <LuPlus />
        </button>
      </TooltipX>
    </div>
  )
}

/** Inline styles serialize as `16px` — strip the unit for display. */
const normalizeFontSize = (value: string) => value.trim();
