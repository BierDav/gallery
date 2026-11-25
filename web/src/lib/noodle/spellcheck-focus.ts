/**
Spellcheck squiggles only while a field is actually being edited.

Applies to the album title and to every autogrow textarea (the album
description is one; it has no attribute of its own beyond a localized
placeholder, so match the primitive). A red-underlined album title is noise
on a page you are only looking at.

Both are shared primitives with no static attribute to set, so the state is
set at runtime as instances appear: off when unfocused, on when focused.

Enabling has to happen before focus lands: Firefox checks existing text only
when an element receives focus, and turning spellcheck on afterwards leaves
the text unchecked until the next keystroke. So arm the element on
pointerdown and Tab keydown, while focus is still moving, and turn everything
that did not end up focused back off once it has settled. Unfocused elements
are never checked, so briefly arming other textareas on Tab is invisible.
*/
export const SPELLCHECK_ON_FOCUS_SELECTOR = [
  'textarea[title="Edit Title"]',
  'section[data-testid="timeline-top-section"] textarea[class~="lg:text-6xl"]',
  'textarea[data-testid="autogrow-textarea"]',
].join(', ');

export const installSpellcheckOnFocus = (document: Document = globalThis.document) => {
  const elements = () => document.querySelectorAll<HTMLElement>(SPELLCHECK_ON_FOCUS_SELECTOR);
  const set = (element: HTMLElement, on: boolean) => {
    if (element.spellcheck !== on) {
      element.spellcheck = on;
    }
  };

  // The single source of truth: focused means checked, anything else does not.
  const sync = () => {
    for (const element of elements()) {
      set(element, element === document.activeElement);
    }
  };

  const arm = (event: Event) => {
    const target = event.target as Element | null;
    const element = target?.closest?.<HTMLElement>(SPELLCHECK_ON_FOCUS_SELECTOR);
    if (element) {
      set(element, true);
    } else if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Tab') {
      // Tab gives no pointer event on the element about to be focused.
      for (const other of elements()) {
        set(other, true);
      }
    }
  };

  const settle = () => setTimeout(sync, 0);

  // Capture phase: these must run before the browser moves focus...
  document.addEventListener('pointerdown', arm, { capture: true });
  document.addEventListener('keydown', arm, { capture: true });
  // ...and after it has moved, so whatever lost (or never got) focus goes off.
  document.addEventListener('focusin', sync, { capture: true });
  document.addEventListener('focusout', settle, { capture: true });

  // childList only: setting .spellcheck reflects to the attribute, and
  // observing attributes would feed the observer its own writes.
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  sync();

  return () => {
    observer.disconnect();
    document.removeEventListener('pointerdown', arm, true);
    document.removeEventListener('keydown', arm, true);
    document.removeEventListener('focusin', sync, true);
    document.removeEventListener('focusout', settle, true);
  };
};
