/**
 * Public entry point for the reusable virtualized log viewer. The
 * implementation lives in ./LogLines.tsx (kept under that filename for
 * backwards-compatible imports). New code should import from this module.
 */
export {
  VirtualizedLogViewer,
  LogLines,
  type VirtualizedLogViewerProps,
} from "./LogLines";
