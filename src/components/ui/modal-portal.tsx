import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into <body> so a `fixed inset-0` overlay is always sized
 * to the main window (the viewport) — never trapped by an ancestor that creates
 * a CSS containing block.
 *
 * Why this is needed: `transform` / `filter` / `will-change` on an ancestor make
 * a descendant `position: fixed` resolve against that ancestor instead of the
 * viewport. Radix dialog content (`.clawx-dialog-content`) uses `transform`, so a
 * nested modal rendered inside a dialog (e.g. the channel-config / add-model
 * popups opened from inside the System Settings dialog) would otherwise clip its
 * backdrop to the parent dialog's size. Portaling to <body> escapes any such
 * ancestor; React context still flows through the portal.
 *
 * Escaping the dialog's DOM subtree, however, also escapes the Radix modal's
 * behaviors that only apply "inside" it, so the wrapper compensates:
 *  - pointer-events: a Radix modal sets `pointer-events: none` on <body>; the
 *    wrapper restores `auto` so the portaled modal stays clickable.
 *  - scroll: Radix's scroll lock (react-remove-scroll) listens for wheel /
 *    touchmove on <document> (bubble phase) and preventDefaults scrolling that
 *    happens outside its whitelisted subtree. We stop those events from bubbling
 *    past the wrapper so the mouse wheel scrolls normally inside the modal
 *    (without this only dragging the scrollbar worked).
 *  - dismissal: `data-app-modal` lets an outer Radix dialog detect interactions
 *    originating here and skip its outside-dismiss (see SystemSettingsModal's
 *    onInteractOutside), so opening a nested modal doesn't close the dialog
 *    behind it.
 *
 * We deliberately do NOT stop pointer/mouse events, so components inside (e.g.
 * Combobox) that rely on document-level listeners keep working.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Stop native events from bubbling to the document listeners installed by an
    // outer Radix modal, so those behaviors don't reach into this portaled tree:
    //  - wheel / touchmove: react-remove-scroll's scroll lock (see file header).
    //  - focusin / focusout: Radix FocusScope traps focus by listening for these
    //    on <document> and refocusing the outer dialog whenever focus lands
    //    outside its container. Since this modal is portaled outside that
    //    container, without stopping propagation the trap would yank focus back
    //    on every focus change here — making inputs impossible to type into.
    const stopPropagation = (event: Event) => event.stopPropagation();
    node.addEventListener('wheel', stopPropagation);
    node.addEventListener('touchmove', stopPropagation);
    node.addEventListener('focusin', stopPropagation);
    node.addEventListener('focusout', stopPropagation);

    // The listeners above only see events that originate *inside* this portal.
    // The very first focus into the modal is different: clicking an input here
    // fires `focusout` on whatever was focused *before* — typically a control
    // inside the outer Radix dialog (e.g. the button that opened this modal).
    // That focusout is dispatched on an element outside `node`, so it bubbles
    // straight to the outer FocusScope's document listener, whose handleFocusOut
    // sees the new focus target (`relatedTarget`) is outside its container and
    // immediately yanks focus back — so the input never actually focuses and no
    // caret ever appears. Intercept that focusout in the capture phase (before
    // it reaches the document-level handler) whenever focus is entering this
    // modal, i.e. `relatedTarget` lives inside our portal.
    const guardFocusEnteringModal = (event: FocusEvent) => {
      const related = event.relatedTarget;
      if (related instanceof Node && node.contains(related)) {
        event.stopPropagation();
      }
    };
    document.addEventListener('focusout', guardFocusEnteringModal, true);

    return () => {
      node.removeEventListener('wheel', stopPropagation);
      node.removeEventListener('touchmove', stopPropagation);
      node.removeEventListener('focusin', stopPropagation);
      node.removeEventListener('focusout', stopPropagation);
      document.removeEventListener('focusout', guardFocusEnteringModal, true);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={ref} data-app-modal style={{ pointerEvents: 'auto' }}>
      {children}
    </div>,
    document.body,
  );
}
