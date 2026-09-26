// Real installed media dependencies, no pairing, network, or messages sent.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { generateThumbnail } from '@whiskeysockets/baileys/lib/Utils/messages-media.js';

const png = await sharp({ create: { width:96, height:64, channels:3, background:'#ffd600' } }).png().toBuffer();
const result = await generateThumbnail(png,'image',{});
assert.deepEqual(result.originalImageDimensions,{width:96,height:64});
assert.equal((await sharp(Buffer.from(result.thumbnail,'base64')).metadata()).format,'jpeg');
assert.match(await QRCode.toDataURL('filey-isolated-qr-fixture'),/^data:image\/png;base64,/);
await assert.rejects(generateThumbnail(Buffer.from('invalid-image'),'image',{}));
console.log('WhatsApp media: thumbnail, dimensions, QR and invalid input passed.');
