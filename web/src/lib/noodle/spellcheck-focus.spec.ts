import { installSpellcheckOnFocus } from '#lib/noodle/spellcheck-focus.ts';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installSpellcheckOnFocus', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    document.body.replaceChildren();
  });

  const render = () => {
    document.body.innerHTML = `
      <textarea title="Edit Title">Ünterwegs</textarea>
      <textarea data-testid="autogrow-textarea">Beschreibung</textarea>
      <textarea id="other">Other</textarea>`;
    return {
      title: document.querySelector<HTMLTextAreaElement>('textarea[title="Edit Title"]')!,
      description: document.querySelector<HTMLTextAreaElement>('[data-testid="autogrow-textarea"]')!,
      other: document.querySelector<HTMLTextAreaElement>('#other')!,
    };
  };

  it('turns spellcheck off on album title and description while they are not focused', () => {
    const { title, description, other } = render();
    uninstall = installSpellcheckOnFocus(document);

    expect(title.spellcheck).toBe(false);
    expect(description.spellcheck).toBe(false);
    expect(other.spellcheck).toBe(true);
  });

  it('arms the field before focus lands and turns it off again after blur', async () => {
    const { title, description } = render();
    uninstall = installSpellcheckOnFocus(document);

    title.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(title.spellcheck).toBe(true);

    title.focus();
    expect(title.spellcheck).toBe(true);
    expect(description.spellcheck).toBe(false);

    title.blur();
    await nextTask();
    expect(title.spellcheck).toBe(false);
  });

  it('applies to fields that appear later', async () => {
    uninstall = installSpellcheckOnFocus(document);
    const { title } = render();
    await nextTask();

    expect(title.spellcheck).toBe(false);
  });
});
