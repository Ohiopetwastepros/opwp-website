import { reviewTechSlug } from './review-request-content.mjs';
import { sanitizeReviewFirstName, REVIEW_PREVIEW_WIDTH, REVIEW_PREVIEW_HEIGHT } from './review-preview-token.mjs';
import { reviewPreviewJpeg } from './review-preview-jpeg.mjs';

export const REVIEW_PREVIEW_FONT = '/assets/fonts/HankenGrotesk-ExtraBold.ttf';
export const REVIEW_PREVIEW_FONT_NAME = 'Hanken Grotesk Review';

// Advance widths from the bundled static ExtraBold font (1000 units/em).
// The additional 6% allowance keeps even long names comfortably inside the box.
const advances = {
  A:686,B:615,C:711,D:671,E:575,F:555,G:737,H:698,I:269,J:557,K:672,L:507,M:862,N:694,O:747,P:564,Q:789,R:616,S:579,T:583,U:658,V:677,W:987,X:679,Y:632,Z:613,
  a:548,b:570,c:524,d:570,e:542,f:353,g:525,h:570,i:252,j:252,k:569,l:282,m:848,n:570,o:571,p:570,q:570,r:433,s:472,t:374,u:570,v:539,w:757,x:549,y:539,z:470,
  '-':327,"'":260,' ':260,'!':256,
};

export function reviewNameLayout(firstName, tech) {
  const name = sanitizeReviewFirstName(firstName);
  if (!name) throw new Error('A valid first name is required for a personalized review preview.');
  const slug = reviewTechSlug(tech);
  // Both faces end above y=250. Craig's vehicle lettering shares the lower
  // frame, so his box sits lower while preserving a large, readable greeting.
  const box = { x:28, y:slug === 'tony' ? 365 : 410, width:1144, height:slug === 'tony' ? 240 : 196, radius:28, padding:48 };
  const text = `${name}!`;
  const widthEm = Array.from(text).reduce((sum, char) => sum + (advances[char] || 1000), 0) / 1000;
  const fontSize = Math.min(slug === 'tony' ? 178 : 172, Math.floor((box.width - box.padding * 2) / (widthEm * 1.06)));
  return { slug, text, box, fontSize, textWidth:widthEm * fontSize, lineHeight:1 };
}

export function reviewPreviewElement({ firstName, tech, imageDataUrl }) {
  const layout = reviewNameLayout(firstName, tech);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(imageDataUrl || '')) throw new Error('The original local review photograph is required.');
  return {
    type:'div', props:{
      style:{ display:'flex', width:REVIEW_PREVIEW_WIDTH, height:REVIEW_PREVIEW_HEIGHT, position:'relative', backgroundColor:'#fff', overflow:'hidden' },
      children:[
        { type:'img', props:{ src:imageDataUrl, width:REVIEW_PREVIEW_WIDTH, height:REVIEW_PREVIEW_HEIGHT, style:{ position:'absolute', top:0, left:0, width:REVIEW_PREVIEW_WIDTH, height:REVIEW_PREVIEW_HEIGHT } } },
        { type:'div', props:{
          style:{ display:'flex', position:'absolute', left:layout.box.x, top:layout.box.y, width:layout.box.width, height:layout.box.height,
            borderRadius:layout.box.radius, backgroundColor:'rgba(31, 58, 122, 0.85)', justifyContent:'center', alignItems:'center',
            paddingLeft:layout.box.padding, paddingRight:layout.box.padding, color:'#fff', fontFamily:REVIEW_PREVIEW_FONT_NAME,
            fontWeight:800, fontSize:layout.fontSize, lineHeight:layout.lineHeight, whiteSpace:'nowrap' },
          children:layout.text,
        } },
      ],
    },
  };
}

async function localAsset(env, pathname) {
  if (!env?.ASSETS?.fetch) throw new Error('Review preview assets are unavailable.');
  const response = await env.ASSETS.fetch(new Request(`https://www.ohiopetwastepros.com${pathname}`));
  if (!response.ok) throw new Error('A required review preview asset could not be loaded.');
  return response.arrayBuffer();
}

function jpegDataUrl(bytes) {
  let binary = '';
  const array = new Uint8Array(bytes);
  for (let offset=0; offset<array.length; offset+=8192) binary += String.fromCharCode(...array.subarray(offset,offset+8192));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export async function renderReviewPreview(env, { firstName, tech }) {
  const layout = reviewNameLayout(firstName, tech);
  const [font, photo, { ImageResponse }] = await Promise.all([
    localAsset(env, REVIEW_PREVIEW_FONT),
    localAsset(env, `/assets/photos/review-${layout.slug}-og.jpg`),
    import('workers-og'),
  ]);
  const response = new ImageResponse(reviewPreviewElement({ firstName, tech:layout.slug, imageDataUrl:jpegDataUrl(photo) }), {
    width:REVIEW_PREVIEW_WIDTH, height:REVIEW_PREVIEW_HEIGHT,
    fonts:[{ name:REVIEW_PREVIEW_FONT_NAME, data:font, weight:800, style:'normal' }],
  });
  return reviewPreviewJpeg(new Uint8Array(await response.arrayBuffer()));
}
