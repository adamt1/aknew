import { readFileSync, writeFileSync } from 'fs';
import { getDocumentProxy, extractText, renderPageAsImage } from 'unpdf';

async function main() {
  try {
    const fileBuffer = readFileSync('test.pdf');
    console.log('PDF loaded:', fileBuffer.length, 'bytes');

    // 1. Try text extraction
    console.log('Extracting text...');
    const pdfProxy = await getDocumentProxy(new Uint8Array(fileBuffer));
    const { text } = await extractText(pdfProxy, { mergePages: true });
    console.log('Extracted text length:', text?.length);
    console.log('Extracted text preview:', text?.substring(0, 500));

    // 2. Try rendering page 1 to image using unpdf
    console.log('Rendering page 1 to image...');
    const imgBuffer = await renderPageAsImage(pdfProxy, 1, {
      scale: 2.0,
      canvasImport: () => import('@napi-rs/canvas')
    });
    console.log('Rendered image buffer length:', imgBuffer.byteLength);
    writeFileSync('test_rendered.png', Buffer.from(imgBuffer));
    console.log('Saved rendered image to test_rendered.png');

  } catch (error) {
    console.error('Error in PDF processing:', error);
  }
}

main();
