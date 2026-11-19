import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import opentype from '@shuding/opentype.js';
import { REVIEW_PREVIEW_WIDTH, REVIEW_PREVIEW_HEIGHT } from '../lib/review-preview-token.mjs';
import { reviewNameLayout, reviewPreviewElement, REVIEW_PREVIEW_FONT } from '../lib/review-preview-renderer.mjs';
import { createReviewPreviewTestWorker } from './helpers/review-preview-worker.mjs';

test('preview names stay on one line within comfortable padding, including worst-case lengths', async () => {
  const bytes = await fs.readFile(new URL(`../public${REVIEW_PREVIEW_FONT}`,import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  for (const tech of ['craig','tony','unknown']) for (const name of ['Jennifer','W'.repeat(40),'M'.repeat(40),'Alexandria-Catherine','O\'Malley','a'.repeat(500),'Éléonore Example']) {
    const layout = reviewNameLayout(name,tech);
    const actualWidth = font.getAdvanceWidth(layout.text,layout.fontSize);
    assert.ok(layout.fontSize > 0 && layout.fontSize <= 178);
    assert.ok(actualWidth <= layout.box.width - 2*layout.box.padding,`${tech}: ${layout.text} fits`);
    assert.ok(layout.textWidth <= layout.box.width - 2*layout.box.padding);
    assert.equal(layout.lineHeight,1);
    assert.doesNotMatch(layout.text,/\n|<|>|\d/);
  }
  assert.ok(reviewNameLayout('Jennifer','tony').fontSize >= 170);
  assert.ok(reviewNameLayout('Jennifer','craig').fontSize >= 170);
  assert.throws(() => reviewNameLayout('123<>','tony'),/valid first name/);
});

test('the lower rounded navy box leaves both faces visible and Craig sits lower', () => {
  const tony = reviewNameLayout('Jennifer','tony'), craig = reviewNameLayout('Jennifer','craig');
  assert.ok(craig.box.y > tony.box.y);
  for (const layout of [tony,craig]) {
    assert.ok(layout.box.y >= 365 && layout.box.y > 250);
    assert.ok(layout.box.x > 0 && layout.box.x+layout.box.width < REVIEW_PREVIEW_WIDTH);
    assert.ok(layout.box.y+layout.box.height < REVIEW_PREVIEW_HEIGHT);
    assert.ok(layout.box.height >= 196);
    const element = reviewPreviewElement({ firstName:'Jennifer',tech:layout.slug,imageDataUrl:'data:image/jpeg;base64,YQ==' });
    const overlay = element.props.children[1];
    assert.equal(overlay.props.children,'Jennifer!');
    assert.equal(overlay.props.style.backgroundColor,'rgba(31, 58, 122, 0.85)');
    assert.equal(overlay.props.style.fontWeight,800);
    assert.equal(overlay.props.style.whiteSpace,'nowrap');
  }
  assert.throws(() => reviewPreviewElement({firstName:'Jennifer',tech:'tony',imageDataUrl:'https://other.example/image.jpg'}),/original local/);
});

test('actual Worker WASM renders Jennifer for both techs at 1200x630 without any send bindings', {timeout:60_000}, async () => {
  const worker = await createReviewPreviewTestWorker();
  try {
    for (const tech of ['craig','tony']) {
      const response = await worker.dispatchFetch(`https://preview.invalid/?tech=${tech}&name=Jennifer`);
      assert.equal(response.status,200);
      assert.equal(response.headers.get('Content-Type'),'image/jpeg');
      const rendered = Buffer.from(await response.arrayBuffer());
      assert.ok(rendered.byteLength <= 400_000, `${tech}: ${rendered.byteLength} bytes fits the preview target`);
      assert.equal(rendered[0], 0xff);
      assert.equal(rendered[1], 0xd8);
      const metadata = await sharp(rendered).metadata();
      assert.equal(metadata.format,'jpeg');
      assert.equal(metadata.width,REVIEW_PREVIEW_WIDTH);
      assert.equal(metadata.height,REVIEW_PREVIEW_HEIGHT);
      // JPEG compression retains the original crop and visible face above
      // the box, with a small bounded difference from the original photo.
      const original = new URL(`../public/assets/photos/review-${tech}-og.jpg`,import.meta.url);
      const faceRegion = {left:tech==='tony'?450:675,top:80,width:90,height:130};
      const expected = await sharp(await fs.readFile(original)).extract(faceRegion).raw().toBuffer();
      const observed = await sharp(rendered).extract(faceRegion).removeAlpha().raw().toBuffer();
      let totalDifference=0;
      for(let i=0;i<expected.length;i++) totalDifference+=Math.abs(expected[i]-observed[i]);
      assert.ok(totalDifference/expected.length<5,'face photograph stays visible without an overlay');
      const overlay = reviewNameLayout('Jennifer',tech).box;
      const center = await sharp(rendered).extract({left:overlay.x+10,top:overlay.y+overlay.height/2,width:1,height:1}).removeAlpha().raw().toBuffer();
      assert.ok(center[2] > center[0] && center[2] > center[1],'box has a navy tint');
    }
  } finally { await worker.dispose(); }
});
