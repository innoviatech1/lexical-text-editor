

import { HeadingAction, LOW_PRIORIRTY, RICH_BLOCK_OPTIONS, RICH_HLINE_OPTIONS, RICH_HIGHLIGHT_OPTIONS, RICH_QUOTE_CODE_OPTIONS, RICH_REDO_UNDO_OPTIONS, RICH_TEXT_OPTIONS, RichTextAction } from "../constants/index"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createParagraphNode, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, CAN_REDO_COMMAND, CAN_UNDO_COMMAND, FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, REDO_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND } from "lexical"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import { type HeadingTagType, $createHeadingNode, $isHeadingNode } from '@lexical/rich-text'
import { $wrapNodes } from '@lexical/selection'
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  TOGGLE_LINK_COMMAND,
  $isLinkNode,
} from "@lexical/link";

import {
  INSERT_HORIZONTAL_RULE_COMMAND,
} from "@lexical/react/LexicalHorizontalRuleNode";

import { $isListNode, ListNode } from '@lexical/list'
import { DropdownList } from "../components/DropdownList"
import Separator from "../components/Separator"
import { HeadingSelectionList } from "../components/HeadingSelectionList"
import { IoIosLink } from "react-icons/io"
import { IoCodeOutline, IoSearchOutline } from "react-icons/io5"
import { BsFullscreen, BsFullscreenExit, BsThreeDots } from "react-icons/bs"
import LinkModal from "../components/LinkModal"
import FindReplaceModal from "../components/FindReplaceModal"
import ToolbarOverflowModal from "../components/ToolbarOverflowModal"
import { AlignmentSelectionList } from "../components/AlignmentSelectionList"
import ColorPlugin from "./ColorPlugin"
import FontFamilyPlugin from "./FontFamilyPlugin"
import FontSizePlugin from "./FontSizePlugin"
import CodeBlockPlugin from "./CodeBlockPlugin"
import ListPlugin from "./ListPlugin"
import TablePlugin from "./TablePlugin"
import ImagePlugin from "./ImagePlugin"
import VideoPlugin from "./VideoPlugin"
import ContentPreviewDialog from "../components/ContentPreview"
import TooltipX from "../components/common/Tooltip"

/**
 * Toolbar segments (3.4): visual order fixed by `SEGMENTS` below. Groups are
 * separated by a vertical `Separator` line; every segment marked `sep: true`
 * starts a new group and renders its group line to its left (undo/redo is
 * the anchor group, rendered in `primaryRef`).
 *
 *  1. undo, redo, clear format            (primaryRef — never collapsed)
 *  2. | headings, font family, font size
 *  3. | bold, italic, underline, strikethrough
 *  4. | uppercase, lowercase & others ("Aa" modal)
 *  5. | text color, bg color, highlight
 *  6. | quote, code, code-block
 *  7. | alignments
 *  8. | ordered list, unordered list, indent, outdent
 *  9. | table, horizontal rule
 * 10. | link, image, embed video
 * 11. | search, source code, fullscreen, preview
 *
 * The list order must remain strictly left-to-right in every toolbar style
 * (wrap / collapse / scrollbar); only collapse priority (COLLAPSIBLE_IDS) is
 * a separate axis.
 */
const SEGMENTS: { id: string; sep?: boolean }[] = [
  // Group 2: headings, font family, font size
  { id: 'headings', sep: true },
  { id: 'fontFamily' },
  { id: 'fontSize' },
  // Group 3: bold, italic, underline, strikethrough
  { id: 'textFormats', sep: true },
  // Group 4: uppercase / lowercase & others (Aa dropdown)
  { id: 'dropdown', sep: true },
  // Group 5: text color, bg color, highlight
  { id: 'color', sep: true },
  // Group 6: quote, code, code-block
  { id: 'quoteCode', sep: true },
  { id: 'codeBlock' },
  // Group 7: alignments
  { id: 'alignment', sep: true },
  // Group 8: ordered/unordered list, indent, outdent
  { id: 'lists', sep: true },
  { id: 'blockOptions' },
  // Group 9: table, horizontal rule
  { id: 'table', sep: true },
  { id: 'hline' },
  // Group 10: link, image, embed video
  { id: 'link', sep: true },
  { id: 'image' },
  { id: 'video' },
  // Group 11: search, source code, fullscreen, preview
  { id: 'utility', sep: true },
  { id: 'preview' },
];
/**
 * Collapse priority (3.4) — visual order. Collapse mode shows a CONTIGUOUS
 * prefix of the wrap layout: the first groups that fit stay in the row,
 * everything from the first non-fitting segment onward is hidden into the
 * "..." modal. `COLLAPSIBLE_IDS` is therefore simply `SEGMENTS` order, and
 * the undo group (rendered in `primaryRef`) is never collapsed.
 */
const SEGMENT_IDS = SEGMENTS.map((s) => s.id);
const SEGMENT_GAP = 6;
const ELLIPSIS_FALLBACK_WIDTH = 40;

export const ToolbarPlugin = ({
  value,
  onImageUpload,
  sourceView = false,
  onToggleSourceView,
  fullscreen = false,
  onToggleFullscreen,
  toolbarStyle = 'wrap',
}: {
  value: string;
  onImageUpload?: (file: File) => Promise<string>;
  sourceView?: boolean;
  onToggleSourceView?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /**
   * 'collapse' (default) — single row; overflowed segments collapse into the
   *   "..." button + modal (predictive fit per COLLAPSIBLE_IDS priority).
   * 'wrap' — all tools flow serially; overflow wraps to the next line.
   * 'scrollbar' — single horizontal row with a slim scrollbar.
   * 'normal' — deprecated alias for 'collapse'.
   */
  toolbarStyle?: 'wrap' | 'collapse' | 'scrollbar' | 'normal';
}) => {

  // Legacy value normalization: 'normal' (the old single-row collapse mode) is
  // now called 'collapse'.
  const normalizedToolbarStyle = toolbarStyle === 'normal' ? 'collapse' : toolbarStyle;

  const [editor] = useLexicalComposerContext();
  const [disableMap, setDisableMap] = useState<{ [id: string]: boolean }>({
    [RichTextAction.Undo]: true,
    [RichTextAction.Redo]: true
  })
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLDivElement | null>(null);
  const ellipsisRef = useRef<HTMLButtonElement | null>(null);
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const widthCache = useRef<Record<string, number>>({});
  const ellipsisWidthRef = useRef(0);
  const customBarRef = useRef<HTMLDivElement | null>(null);
  const customThumbRef = useRef<HTMLDivElement | null>(null);
  const [selectionMap, setSelectionMap] = useState<{ [id: string]: boolean }>({
    [RichTextAction.LeftAlign]: true,
  })
  const [headingSelectionMap, setHeadingSelectionMap] = useState<{ [id: string]: boolean }>({
    [HeadingAction.Normal]: true,
  })
  const [blockType, setBlockType] = useState('paragraph');
  const [linkUrl, setLinkUrl] = useState("https://");
  let initialLoad = true



  const updateToolbar = () => {



    if (initialLoad) {
      const root = editor.getRootElement();
      if (root) {
        root.scrollTop = 0;
        initialLoad = false
      }
    }


    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
      const newSelectionMap = {
        [RichTextAction.Bold]: selection.hasFormat("bold"),
        [RichTextAction.Italics]: selection.hasFormat("italic"),
        [RichTextAction.Underline]: selection.hasFormat("underline"),
        [RichTextAction.Uppercase]: selection.hasFormat("uppercase"),
        [RichTextAction.Lowercase]: selection.hasFormat("lowercase"),
        [RichTextAction.Capitalize]: selection.hasFormat("capitalize"),
        [RichTextAction.Strikethrough]: selection.hasFormat("strikethrough"),
        [RichTextAction.Superscript]: selection.hasFormat("superscript"),
        [RichTextAction.Subscript]: selection.hasFormat("subscript"),
        [RichTextAction.Code]: selection.hasFormat("code"),
        [RichTextAction.Highlight]: selection.hasFormat("highlight"),
      }

      setSelectionMap(newSelectionMap);

      // headings------------------

      const anchorNode = selection.anchor.getNode();
      const element = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDom = editor.getElementByKey(elementKey);

      if (!elementDom) return;
      if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNode)
        const type = parentList ? parentList.getTag() : element.getTag();
        setBlockType(type)
      }
      else if (element.getType() === "paragraph" || $isHeadingNode(element)) {
        let tag: string | null = null;
        if ($isHeadingNode(element)) {
          tag = element.getTag();
        }
        const newHeadingSelectionMap = {
          [HeadingAction.H1]: tag === "h1",
          [HeadingAction.H2]: tag === "h2",
          [HeadingAction.H3]: tag === "h3",
          [HeadingAction.H4]: tag === "h4",
          [HeadingAction.H5]: tag === "h5",
          [HeadingAction.H6]: tag === "h6",
          [HeadingAction.Normal]: element.getType() === "paragraph",
        };
        setBlockType(element.getType())
        setHeadingSelectionMap(newHeadingSelectionMap);
      }
      else {
        setBlockType(element.getType());
      }

      // ----------------------- alignments

      const target = $isElementNode(anchorNode) ? anchorNode : element;

      const alignment = target.getFormat();
      // returns: 'left' = 1 | 'right' = 3 | 'center' = 2 | 'justify' = 4 | '' = 0 (default)
      setSelectionMap((prev) => ({
        ...prev,
        [RichTextAction.LeftAlign]: alignment === 0 || alignment === 1,
        [RichTextAction.CenterAlign]: alignment === 2,
        [RichTextAction.RightAlign]: alignment === 3,
        [RichTextAction.JustifyAlign]: alignment === 4,
      }));

      // ----------------------- quotes

      if (element.getType() === "quote") {
        setSelectionMap((prev) => ({
          ...prev,
          [RichTextAction.Quote]: true,
        }));
      }
      else {
        setSelectionMap((prev) => ({
          ...prev,
          [RichTextAction.Quote]: false,
        }));
      }

      // Update links
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      if ($isLinkNode(parent)) {
        setSelectionMap((prev) => ({
          ...prev,
          [RichTextAction.Link]: true,
        }));

        setLinkUrl(parent.getURL());
        setLinkModalOpen(true);
      } else if ($isLinkNode(node)) {
        setSelectionMap((prev) => ({
          ...prev,
          [RichTextAction.Link]: true,
        }));
        setLinkUrl(node.getURL());
        setLinkModalOpen(true);
      } else {
        setSelectionMap((prev) => ({
          ...prev,
          [RichTextAction.Link]: false,
        }));
        setLinkUrl("https://")
        setLinkModalOpen(false);
      }

    }
  }



  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
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
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setDisableMap(prevDisableMap => ({
            ...prevDisableMap, undo: !payload
          }))
          return false;
        },
        LOW_PRIORIRTY

      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setDisableMap(prevDisableMap => ({
            ...prevDisableMap, redo: !payload
          }))
          return false;
        },
        LOW_PRIORIRTY
      )
    )
  }, [])

  // ---------------- Overflow (3.3) + toolbar style (3.2) ----------------

  const isScrollbarMode = normalizedToolbarStyle === 'scrollbar';

  /**
   * Predictive fit: measures the primary row and every segment (hidden
   * segments from a width cache), then collapses non-primary segments from
   * the end until the toolbar fits. State is only written on change, so the
   * measure -> render -> measure cycle always terminates.
   * Only active in 'collapse' mode; 'wrap' shows all tools across extra
   * lines instead, and 'scrollbar' just scrolls.
   */
  const syncOverflow = useCallback(() => {
    if (normalizedToolbarStyle !== 'collapse') return;
    const row = rowRef.current;
    if (!row) return;
    // The row has no padding/border, so clientWidth is the usable width
    const available = row.clientWidth;
    if (available <= 0) return;

    const primaryWidth = primaryRef.current ? primaryRef.current.offsetWidth : 0;
    const widths = SEGMENT_IDS.map((id) => {
      const el = segmentRefs.current[id];
      if (el && el.style.display !== 'none') {
        widthCache.current[id] = el.offsetWidth;
      }
      return widthCache.current[id] ?? 0;
    });
    if (ellipsisRef.current) {
      ellipsisWidthRef.current = ellipsisRef.current.offsetWidth;
    }
    const ellipsisWidth = ellipsisWidthRef.current || ELLIPSIS_FALLBACK_WIDTH;

    const computeTotal = (k: number) => {
      // k segments (from the visual end) are hidden in the modal
      const visibleCount = 1 + (k > 0 ? 1 : 0) + (SEGMENT_IDS.length - k);
      let total =
        primaryWidth +
        Math.max(0, visibleCount - 1) * SEGMENT_GAP +
        (k > 0 ? ellipsisWidth : 0);
      for (let i = 0; i < SEGMENT_IDS.length - k; i++) {
        total += widths[i];
      }
      return total;
    };

    let k = collapsedCount;
    while (k < SEGMENT_IDS.length && computeTotal(k) > available) k++;
    while (k > 0 && computeTotal(k - 1) <= available) k--;
    setCollapsedCount((prev) => (prev === k ? prev : k));
  }, [collapsedCount, normalizedToolbarStyle]);

  // Re-measure after every render (selection changes resize dropdown labels)
  useEffect(() => {
    syncOverflow();
  });
  const syncOverflowRef = useRef<() => void>(() => { });
  syncOverflowRef.current = syncOverflow;

  // Row width changes (resize must refresh BOTH the overflow collapse and the custom scrollbar)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => {
      syncOverflowRef.current();
      customScrollbarSyncRef.current();
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (collapsedCount === 0) setOverflowOpen(false);
  }, [collapsedCount]);

  useEffect(() => {
    if (normalizedToolbarStyle !== 'collapse') setCollapsedCount(0);
  }, [normalizedToolbarStyle]);

  // ---------------- Custom slim scrollbar (scrollbar mode) ----------------

  /**
   * Native scrollbars can't be restyled reliably in modern Chromium (no
   * arrow removal / exact thickness), so scrollbar mode hides the native bar
   * and renders a custom slim one. All updates write the DOM directly — no
   * state — so scrolling never triggers re-renders.
   */
  const updateCustomScrollbar = useCallback(() => {
    if (normalizedToolbarStyle !== 'scrollbar') return;
    const row = rowRef.current;
    const bar = customBarRef.current;
    const thumb = customThumbRef.current;
    if (!row || !bar || !thumb) return;
    const trackWidth = row.clientWidth;
    const overflow = row.scrollWidth - trackWidth;
    if (overflow <= 1) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const thumbWidth = Math.max(24, (trackWidth / row.scrollWidth) * trackWidth);
    const maxScroll = row.scrollWidth - trackWidth;
    const maxOffset = trackWidth - thumbWidth;
    const offset = maxScroll > 0 ? (row.scrollLeft / maxScroll) * maxOffset : 0;
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${offset}px)`;
  }, [toolbarStyle]);

  const handleThumbPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const row = rowRef.current;
    const thumb = customThumbRef.current;
    if (!row || !thumb) return;
    const startX = event.clientX;
    const startScrollLeft = row.scrollLeft;
    const trackWidth = row.clientWidth;
    const thumbWidth = Math.max(24, (trackWidth / row.scrollWidth) * trackWidth);
    const maxScroll = row.scrollWidth - trackWidth;
    const maxOffset = trackWidth - thumbWidth;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      // Browser clamps scrollLeft to [0, maxScroll]
      row.scrollLeft = maxOffset > 0
        ? startScrollLeft + (dx / maxOffset) * maxScroll
        : 0;
    };
    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, []);

  const handleTrackPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    const track = customBarRef.current;
    if (!row || !track) return;
    // Center the thumb under the pointer, clamped by the browser
    const trackRect = track.getBoundingClientRect();
    const ratio = (event.clientX - trackRect.left) / trackRect.width;
    row.scrollLeft = ratio * row.scrollWidth - row.clientWidth / 2;
  }, []);

  // ---------------- Icon optical normalization ----------------

  /**
   * Icons come from different react-icons packs (Bootstrap 16px viewBox,
   * Tabler/Remix 24px, FontAwesome 512px, Ant 1024px...) and the visible
   * glyph ("ink") occupies a wildly different share of each viewBox
   * (0.5 – 1.0), so equal css boxes still render unequal-looking glyphs.
   * This measures every toolbar svg's real ink bounds and sizes it so the
   * glyph lands at a constant ~15px, clamped to [17px, 22px] so extremely
   * sparse glyphs (e.g. Tabler's bold/italic/underline, dots) never balloon
   * into boxes that read oversized next to their neighbours.
   */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const normalizeIconSizes = useCallback(() => {
    const root = wrapperRef.current;
    if (!root) return;
    for (const svgElem of root.querySelectorAll('.lte-toolbar-row svg:not(.chevron), .lte-overflow-panel svg:not(.chevron)')) {
      // stepper icons are proportioned by CSS, skip normalization
      if (svgElem.closest('.lexical-stepper')) continue;
      const svg = svgElem as SVGSVGElement;
      try {
        const vb = svg.viewBox?.baseVal;
        if (!vb || !vb.width) continue;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        svg.querySelectorAll('path, circle, rect, ellipse, polygon, polyline, line').forEach((s) => {
          const geo = s as SVGGeometryElement;
          const b = geo.getBBox();
          if (b.width || b.height) {
            x1 = Math.min(x1, b.x);
            y1 = Math.min(y1, b.y);
            x2 = Math.max(x2, b.x + b.width);
            y2 = Math.max(y2, b.y + b.height);
          }
        });
        if (x2 === -Infinity) continue;
        const inkRatio = ((x2 - x1) / vb.width + (y2 - y1) / vb.height) / 2;
        if (!isFinite(inkRatio) || inkRatio <= 0) continue;
        const size = Math.min(22, Math.max(17, 15 / inkRatio));
        if (parseFloat(svg.style.width) !== size) {
          svg.style.width = `${size}px`;
          svg.style.height = `${size}px`;
        }
      } catch {
        /* svg that can't be measured is left at the CSS default size */
      }
    }
  }, []);

  // Re-run after every render (icons swap: fullscreen <-> exit, undo/redo enable state, selection icons)
  useEffect(() => {
    normalizeIconSizes();
  });

  // Re-measure the custom scrollbar after every render (labels change widths)
  useEffect(() => {
    updateCustomScrollbar();
  });
  const customScrollbarSyncRef = useRef<() => void>(() => { });
  customScrollbarSyncRef.current = updateCustomScrollbar;

  // Native scroll events drive the custom thumb position
  useEffect(() => {
    if (normalizedToolbarStyle !== 'scrollbar') return;
    const row = rowRef.current;
    if (!row) return;
    const onScroll = () => updateCustomScrollbar();
    row.addEventListener('scroll', onScroll);
    return () => row.removeEventListener('scroll', onScroll);
  }, [normalizedToolbarStyle, updateCustomScrollbar]);

  const onAction = (id: RichTextAction) => {
    switch (id) {
      case RichTextAction.Bold: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")
        break;
      }
      case RichTextAction.Italics: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
        break;
      }
      case RichTextAction.Underline: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")
        break;
      }
      case RichTextAction.Lowercase: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "lowercase")
        break;
      }
      case RichTextAction.Uppercase: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "uppercase")
        break;
      }
      case RichTextAction.Capitalize: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "capitalize")
        break;
      }
      case RichTextAction.Strikethrough: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
        break;
      }
      case RichTextAction.Superscript: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "superscript")
        break;
      }
      case RichTextAction.Subscript: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "subscript")
        break;
      }
      case RichTextAction.Highlight: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "highlight")
        break;
      }
      case RichTextAction.Code: {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")
        break;
      }
      case RichTextAction.Quote: {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const anchorNode = selection.anchor.getNode();
            const parent = anchorNode.getParent();

            if (parent && $isQuoteNode(parent)) {
              $setBlocksType(selection, () => $createParagraphNode());
            } else {
              $wrapNodes(selection, () => $createQuoteNode());
            }
          }
        });
        break;
      }
      case RichTextAction.Link: {
        insertLink();
        setLinkModalOpen(true);
        break;
      }
      case RichTextAction.LeftAlign: {
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')
        break;
      }
      case RichTextAction.RightAlign: {
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')
        break;
      }
      case RichTextAction.CenterAlign: {
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')
        break;
      }
      case RichTextAction.JustifyAlign: {
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'justify')
        break;
      }
      case RichTextAction.Undo: {
        editor.dispatchCommand(UNDO_COMMAND, undefined)
        break;
      }
      case RichTextAction.Redo: {
        editor.dispatchCommand(REDO_COMMAND, undefined)
        break;
      }
      case RichTextAction.ClearFormatting: {
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          const textNodes = selection.getNodes().filter($isTextNode);
          for (const node of textNodes) {
            node.setFormat(0);
            node.setStyle("");
          }
        });
        break;
      }
      case RichTextAction.HorizontalRule: {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        break;
      }
      case RichTextAction.Indent: {
        editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)
        break;
      }
      case RichTextAction.Outdent: {
        editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)
        break;
      }
    }
  }

  // useKeyBindings({ onAction });

  // const getSelectedBtnProps = (
  //   isSelected: boolean
  // ): Partial<IconButtonProps> =>
  //   isSelected
  //     ? {
  //       colorScheme: "blue",
  //       variant: "solid",
  //     }
  //     : {};
  // const ref = useRef<HTMLSelectElement | null>(null)

  const updateHeading = (heading: HeadingTagType | 'normal') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (heading === "normal") {
          $wrapNodes(selection, () => $createParagraphNode());
        } else {
          $wrapNodes(selection, () => $createHeadingNode(heading));
        }
      }
    });
  };

  // const insertLink = useCallback(() => {
  //   console.log('insertlink');
  //   const selection = $getSelection();
  //   if (!$isRangeSelection(selection) || selection.isCollapsed()) {
  //     // Nothing selected → do nothing
  //     return;
  //   }

  //   if (!linkModalOpen) {
  //     if (linkUrl !== "") {
  //       editor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl);
  //     }
  //   } else {
  //     editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
  //   }
  // }, [editor, linkModalOpen]);

  const insertLink = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        // Nothing selected → do nothing
        return;
      }

      if (!linkModalOpen) {
        if (linkUrl !== "") {
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl);
        }
      } else {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      }
    });
  }, [editor, linkModalOpen, linkUrl]);


  const removeLink = useCallback(() => {
    setLinkUrl("")
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setLinkModalOpen(false)
  }, [editor])


  //      <div className="flex gap-1.5 justify-start items-center p-1.5 pb-2 mb-1 border-b-[1px] overflow-x-auto overflow-y-hidden scrollbar-thin">

  // Contiguous suffix rule: the last `collapsedCount` segments (visual order)
  // are hidden into the "..." modal, so collapse matches the wrap layout.
  const isSegmentHidden = (id: string) => {
    const pos = SEGMENT_IDS.indexOf(id);
    return pos >= SEGMENT_IDS.length - collapsedCount;
  };

  const segmentNodes: Record<string, ReactNode> = {
    // Group 2: headings, font family, font size
    headings: (
      <HeadingSelectionList updateHeading={updateHeading} headingSelectionMap={headingSelectionMap} />
    ),
    fontFamily: <FontFamilyPlugin />,
    fontSize: <FontSizePlugin />,
    // Group 3: bold, italic, underline, strikethrough
    textFormats: (
      <>
        {
          RICH_TEXT_OPTIONS.map(({ id, label, icon }) => (
            id === RichTextAction.Divider ? <Separator key={id} /> :
              <TooltipX key={id} content={label} direction="bottom">
                <button type="button"
                  className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                    } icon`}
                  onClick={() => onAction(id)}
                >
                  {icon}
                </button>
              </TooltipX>
          ))
        }
      </>
    ),
    // Group 4: uppercase / lowercase & others ("Aa" modal)
    dropdown: <DropdownList onAction={onAction} selectionMap={selectionMap} />,
    // Group 5: text color, bg color + highlight
    color: (
      <>
        <ColorPlugin />
        {
          RICH_HIGHLIGHT_OPTIONS.map(({ id, label, icon }) => (
            <TooltipX key={id} content={label} direction="bottom">
              <button type="button"
                className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                  } icon`}
                onClick={() => onAction(id)}
              >
                {icon}
              </button>
            </TooltipX>
          ))
        }
      </>
    ),
    // Group 6: quote, code + code-block dropdown
    quoteCode: (
      <>
        {
          RICH_QUOTE_CODE_OPTIONS.map(({ id, label, icon }) => (
            <TooltipX key={id} content={label} direction="bottom">
              <button type="button"
                className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                  } icon`}
                onClick={() => onAction(id)}
              >
                {icon}
              </button>
            </TooltipX>
          ))
        }
      </>
    ),
    codeBlock: <CodeBlockPlugin />,
    // Group 8: alignments
    alignment: (
      <AlignmentSelectionList onAction={onAction} alignmentSelectionMap={selectionMap} />
    ),
    // Group 9: ordered/unordered list + indent, outdent
    lists: <ListPlugin blockType={blockType} />,
    blockOptions: (
      <>
        {
          RICH_BLOCK_OPTIONS.map(({ id, label, icon }) => (
            id === RichTextAction.Divider ? <Separator key={id} /> :
              <TooltipX key={id} content={label} direction="bottom">
                <button type="button"
                  className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                    } icon`}
                  onClick={() => onAction(id)}
                >
                  {icon}
                </button>
              </TooltipX>
          ))
        }
      </>
    ),
    // Group 10: table + horizontal rule
    table: <TablePlugin />,
    hline: (
      <>
        {
          RICH_HLINE_OPTIONS.map(({ id, label, icon }) => (
            <TooltipX key={id} content={label} direction="bottom">
              <button type="button"
                className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                  } icon`}
                onClick={() => onAction(id)}
              >
                {icon}
              </button>
            </TooltipX>
          ))
        }
      </>
    ),
    // Group 11: link, image, embed video
    link: (
      <TooltipX content="Link" direction="bottom">
        <button type="button"
          className={`size-10 lexical-btn ${selectionMap[RichTextAction.Link] ? "toolbarActive" : "toolbar"
            } icon`}
          onClick={() => onAction(RichTextAction.Link)}
          disabled={!!disableMap[RichTextAction.Link]}
        >
          {<IoIosLink />}
        </button>
      </TooltipX>
    ),
    image: <ImagePlugin onImageUpload={onImageUpload} />,
    video: <VideoPlugin />,
    // Group 12: search, source code, fullscreen + preview
    utility: (
      <>
        <TooltipX content="Find & Replace" direction="bottom">
          <button type="button"
            aria-label="Find & Replace"
            className={`size-10 lexical-btn ${findReplaceOpen ? "toolbarActive" : "toolbar"
              } icon`}
            onClick={() => setFindReplaceOpen((prev) => !prev)}
          >
            <IoSearchOutline />
          </button>
        </TooltipX>
        <TooltipX content="Source Code View" direction="bottom">
          <button type="button"
            aria-label="Source Code View"
            className={`size-10 lexical-btn ${sourceView ? "toolbarActive" : "toolbar"
              } icon`}
            onClick={() => onToggleSourceView?.()}
          >
            <IoCodeOutline />
          </button>
        </TooltipX>
        <TooltipX content={fullscreen ? "Exit Fullscreen" : "Fullscreen"} direction="bottom">
          <button type="button"
            aria-label={fullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className={`size-10 lexical-btn ${fullscreen ? "toolbarActive" : "toolbar"
              } icon`}
            onClick={() => onToggleFullscreen?.()}
          >
            {fullscreen ? <BsFullscreenExit /> : <BsFullscreen />}
          </button>
        </TooltipX>
      </>
    ),
    preview: <ContentPreviewDialog value={value} />,
  };

  return (
    <div
      ref={wrapperRef}
      className="lexical-toolbar-wrapper"
      style={{
        position: 'relative',
        padding: 12, marginBottom: 4, borderBottom: '1px solid #e5e7eb'
      }}
    >
      <div
        ref={rowRef}
        className={`lte-toolbar-row ${isScrollbarMode ? "useScroll" : normalizedToolbarStyle === 'collapse' ? "lte-nowrap" : "lte-wrap"}`}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div ref={primaryRef} className="lte-toolbar-primary" style={{ display: 'flex', gap: 6, justifyContent: 'start', alignItems: 'center' }}>
          {
            RICH_REDO_UNDO_OPTIONS.map(({ id, label, icon }) => (
              id === RichTextAction.Divider ? <Separator key={id} /> :
                <TooltipX content={label} direction="bottom" key={label}>
                  <button type="button"
                    className={`size-10 lexical-btn ${selectionMap[id] ? "toolbarActive" : "toolbar"
                      } icon`}
                    onClick={() => onAction(id)}
                    disabled={!!disableMap[id]}
                  >
                    {icon}
                  </button>
                </TooltipX>
            ))
          }
        </div>

        {SEGMENTS.map(({ id, sep }) => {
          const hidden = isSegmentHidden(id);
          return (
            <div
              key={id}
              ref={(el) => { segmentRefs.current[id] = el; }}
              style={hidden
                ? { display: 'none' }
                : { display: 'flex', gap: 6, justifyContent: 'start', alignItems: 'center' }}
            >
              {sep ? <Separator /> : null}
              {hidden ? null : segmentNodes[id]}
            </div>
          );
        })}

        {collapsedCount > 0 &&
          <TooltipX content="More tools" direction="bottom">
            <button type="button"
              ref={ellipsisRef}
              aria-label="More tools"
              className={`size-10 lexical-btn ${overflowOpen ? "toolbarActive" : "toolbar"
                } icon`}
              onClick={() => setOverflowOpen((prev) => !prev)}
            >
              <BsThreeDots />
            </button>
          </TooltipX>}
      </div>

      {isScrollbarMode &&
        <div
          ref={customBarRef}
          className="lte-custom-scrollbar"
          onPointerDown={handleTrackPointerDown}
          aria-hidden="true"
        >
          <div
            ref={customThumbRef}
            className="lte-custom-scrollbar-thumb"
            onPointerDown={handleThumbPointerDown}
          />
        </div>}

      {linkModalOpen &&
        <LinkModal
          linkUrl={linkUrl}
          setLinkUrl={setLinkUrl}
          removeLink={removeLink}
          onConfirm={(url) => {
            // Dispatch TOGGLE_LINK_COMMAND with the URL directly
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, {
              url: url,
              target: "_blank",
            });


            // Update state for modal and UI
            setLinkUrl(url);
            setLinkModalOpen(false);
          }}

          onCancel={() => {
            setLinkUrl("")
            // editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
            setLinkModalOpen(false)
          }}
        />}

      {overflowOpen &&
        <ToolbarOverflowModal anchorRef={ellipsisRef} onClose={() => setOverflowOpen(false)}>
          {SEGMENTS
            .filter(({ id }) => isSegmentHidden(id) && segmentNodes[id])
            .map(({ id, sep }, i) => (
              <div key={id} className="lte-overflow-item">
                {sep && i > 0 ? <Separator /> : null}
                {segmentNodes[id]}
              </div>
            ))}
        </ToolbarOverflowModal>}

      {findReplaceOpen &&
        <FindReplaceModal
          onClose={() => setFindReplaceOpen(false)}
        />}


      {/* <YoutubePlugin /> */}
    </div>
  )
}


