import { createContext, useContext } from "react";

/**
 * Lets toolbar tools ask the toolbar to close its "..." overflow panel.
 * Block-level actions (code block, table insert, ...) commit and then need
 * the panel out of the way — it floats over the editor content and would
 * otherwise swallow the user's next click "on the code/table".
 */
export const OverflowCloseContext = createContext<() => void>(() => {});

export function useCloseToolbarOverflow(): () => void {
  return useContext(OverflowCloseContext);
}
