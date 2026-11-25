import { getContentDispositionHeader } from 'src/utils/file.js';

describe(getContentDispositionHeader.name, () => {
  it('percent-encodes the characters encodeURIComponent leaves raw', () => {
    expect(getContentDispositionHeader('attachment', "IMG(0) it's *new*!.jpg")).toBe(
      "attachment; filename*=UTF-8''IMG%280%29%20it%27s%20%2Anew%2A%21.jpg",
    );
  });

  it('keeps ordinary names and UTF-8 encoding unchanged', () => {
    expect(getContentDispositionHeader('inline', 'Übersicht 1.jpeg')).toBe(
      "inline; filename*=UTF-8''%C3%9Cbersicht%201.jpeg",
    );
  });
});
