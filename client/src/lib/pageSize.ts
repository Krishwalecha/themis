import { useEffect, useState, type RefObject } from "react";

// a table row (.table td) is 54px tall
const ROW = 54;
// header row, pagination bar and breathing room under the table
const CHROME = 54 + 64 + 24;

// lists that sit side by side in panels share one size, so their rows and pagination line up
export const PANEL_PAGE_SIZE = 6;

// How many rows fit between the top of a full-page table and the bottom of the window, so one page
// fills the screen without scrolling past its pagination. Recomputed when the window is resized.
export const useFitPageSize = (ref: RefObject<HTMLElement | null>): number => {
  const [size, setSize] = useState(15);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // the table's distance from the top of the page, not of the current scroll position
      const scroller = el.closest(".content") ?? document.scrollingElement;
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      const fits = Math.floor((window.innerHeight - top - CHROME) / ROW);
      setSize(Math.min(50, Math.max(6, fits)));
    };
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [ref]);
  return size;
};
