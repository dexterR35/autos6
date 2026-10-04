import { createContext, useContext } from 'react';

/** Shell-level refs (e.g. the overlaid header) that the garage stage must keep clear. */
export const ShellContext = createContext({ headerRef: { current: null } });
export const useShell = () => useContext(ShellContext);
