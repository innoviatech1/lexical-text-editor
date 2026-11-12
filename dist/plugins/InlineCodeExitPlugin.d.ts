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
export default function InlineCodeExitPlugin(): any;
