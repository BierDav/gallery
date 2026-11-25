import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';

const logo = fs.readFileSync('noodle-gallery-mark.svg');

// Favicons from the mark (square). Trim its viewBox padding first by fit.
const sizes = { 'favicon-16.png':16,'favicon-32.png':32,'favicon-48.png':48,
  'favicon-96.png':96,'favicon-144.png':144,'favicon-256.png':256,
  'favicon.png':256,'apple-icon-180.png':180 };
for (const [name,px] of Object.entries(sizes)) {
  await sharp(logo, { density: 512 })
    .resize(px, px, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
    .png().toFile(name);
}
// apple-touch icons are shown on colored home screens; give it a solid bg
await sharp(logo, { density: 512 })
  .resize(180,180,{ fit:'contain', background:{r:255,g:255,b:255,alpha:1} })
  .flatten({ background:'#ffffff' }).png().toFile('apple-icon-180.png');

const ico = await pngToIco(['favicon-16.png','favicon-32.png','favicon-48.png']);
fs.writeFileSync('favicon.ico', ico);

// Previews (logos on dark & light swatches, favicon)
async function preview(svgPath, bg, out){
  const s = fs.readFileSync(svgPath);
  const img = await sharp(s,{density:384}).resize(560,null,{fit:'inside'}).png().toBuffer();
  const m = await sharp(img).metadata();
  await sharp({create:{width:600,height:m.height+40,channels:4,background:bg}})
    .composite([{input:img,left:20,top:20}]).png().toFile(out);
}
await preview('gallery-logo-inline-dark.svg', '#1b1b1b', 'prev-dark.png');
await preview('gallery-logo-inline-light.svg','#ffffff', 'prev-light.png');
await sharp('favicon-256.png').png().toFile('prev-favicon.png');
console.log('done; ico bytes', fs.statSync('favicon.ico').size);
