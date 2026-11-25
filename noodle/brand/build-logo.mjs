import * as fontkit from 'fontkit';
import fs from 'fs';

// Google Sans, sourced from Google Fonts (decompressed from the CDN woff2).
// The wordmark is OUTLINED to vector paths so it antialiases in every browser
// (SVG-in-<img> text can render un-antialiased when the embedded font path is
// used); paths have no font-loading dependency.
const font = fontkit.openSync('GoogleSansGF.ttf');

function run(text, wght, penStart) {
  const vf = font.getVariation({ wght });
  let penX = penStart;
  const glyphs = [];
  let minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity;
  for (const ch of text) {
    const g = vf.glyphForCodePoint(ch.codePointAt(0));
    const d = g.path.toSVG();
    if (d && ch !== ' ') {
      glyphs.push({ d, penX });
      const b = g.path.bbox;
      minY=Math.min(minY,b.minY); maxY=Math.max(maxY,b.maxY);
      minX=Math.min(minX,penX+b.minX); maxX=Math.max(maxX,penX+b.maxX);
    }
    penX += g.advanceWidth;
  }
  return { glyphs, advance: penX, minX, maxX, minY, maxY };
}

const spaceAdv = font.getVariation({ wght: 400 }).glyphForCodePoint(32).advanceWidth;
const noodle  = run('Noodle', 680, 0);
const gallery = run('Gallery', 400, noodle.advance + spaceAdv * 0.9);

const minX=Math.min(noodle.minX,gallery.minX), maxX=Math.max(noodle.maxX,gallery.maxX);
const minY=Math.min(noodle.minY,gallery.minY), maxY=Math.max(noodle.maxY,gallery.maxY);
const padX=(maxY-minY)*0.05, padY=(maxY-minY)*0.12;
const vb=[ (minX-padX).toFixed(1), (-(maxY)-padY).toFixed(1),
           ((maxX-minX)+2*padX).toFixed(1), ((maxY-minY)+2*padY).toFixed(1) ];

const paths = (r,fill)=>r.glyphs
  .map(g=>`    <path transform="translate(${g.penX.toFixed(1)} 0)" d="${g.d}" fill="${fill}"/>`)
  .join('\n');

function svg({ noodleFill, galleryFill }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" role="img" aria-label="Noodle Gallery">
  <g transform="matrix(1 0 0 -1 0 0)">
${paths(noodle, noodleFill)}
${paths(gallery, galleryFill)}
  </g>
</svg>
`;
}

fs.writeFileSync('gallery-logo-inline-light.svg', svg({ noodleFill:'#202124', galleryFill:'#444746' }));
fs.writeFileSync('gallery-logo-inline-dark.svg',  svg({ noodleFill:'#ffffff', galleryFill:'#C4C7C5' }));
console.log('viewBox', vb.join(' '), '| light', fs.statSync('gallery-logo-inline-light.svg').size, 'bytes');
