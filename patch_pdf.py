import re

with open('src/app/api/webhook/route.ts', 'r') as f:
    content = f.read()

# Replace pdf-to-png-converter import
content = content.replace("import { pdfToPng } from 'pdf-to-png-converter';", "")

# Replace the PDF Extraction block
old_pdf_block = """            // PDF Extraction (Hybrid Flow: Text first, then Image)
            if (mimeType === 'application/pdf' && fileBuffer) {
              originalPdfBuffer = fileBuffer;
              try {
                console.log('[VISION] Extracting text from PDF...');
                // @ts-ignore
                const pdfParse = (await import('pdf-parse'));
                const pdfData = await (pdfParse as any)(fileBuffer);
                if (pdfData.text && pdfData.text.trim().length > 50) {
                  const extractedText = pdfData.text.replace(/\\n\\s*\\n/g, '\\n').substring(0, 15000);
                  text = `${text || '[מסמך PDF]'}\\n\\n--- תוכן טקסטואלי שחולץ מהמסמך ---\\n${extractedText}`;
                  // Mark as processed text-wise, might still try image thumbnail for context
                  console.log(`[VISION] PDF text extracted: ${extractedText.length} chars.`);
                }
              } catch (pdfParseErr: any) {
                console.error(`[PDF Parse Error] ${pdfParseErr.message}`);
              }

              // Try PDF to Image conversion as a fallback/visual context
              try {
                console.log('[VISION] Converting PDF to image for visual analysis...');
                const pngPages = await pdfToPng(fileBuffer as any, { 
                  pagesToProcess: Array.from({length: 3}, (_, i) => i + 1), // Limit to 3 for speed when text is available
                  viewportScale: 1.5 // Lower scale for context
                });
                if (pngPages.length > 0 && pngPages[0].content) {
                  fileBuffer = Buffer.from(pngPages[0].content);
                  mimeType = 'image/png';
                  console.log(`[VISION] PDF converted to image context.`);
                }
              } catch (pdfErr: any) {
                console.warn(`[PDF Image Fallback Failed] ${pdfErr.message}`);
                // If text exists, we don't care about image conversion failing
              }
            }"""

new_pdf_block = """            // PDF Extraction
            if (mimeType === 'application/pdf' && fileBuffer) {
              originalPdfBuffer = fileBuffer;
              try {
                console.log('[VISION] Converting PDF to image for visual analysis...');
                const { PDFParse } = await import('pdf-parse');
                const parser = new PDFParse({ data: fileBuffer });
                const screenshotRes = await parser.getScreenshot({ scale: 1.5 });
                
                if (screenshotRes && screenshotRes.pages && screenshotRes.pages.length > 0) {
                  const dataUrl = screenshotRes.pages[0].dataUrl;
                  const parts = dataUrl.split(',');
                  const mimeMatch = parts[0].match(/:(.*?);/);
                  if (mimeMatch && parts[1]) {
                    mimeType = mimeMatch[1];
                    fileBuffer = Buffer.from(parts[1], 'base64');
                    console.log(`[VISION] PDF converted to image context using pdf-parse.`);
                  }
                }
              } catch (pdfErr: any) {
                console.warn(`[PDF Image Fallback Failed] ${pdfErr.message}`);
                try {
                  const { PDFParse } = await import('pdf-parse');
                  const parser = new PDFParse({ data: fileBuffer });
                  const pdfData = await parser.getText();
                  if (pdfData.text && pdfData.text.trim().length > 10) {
                     text = `${text || '[מסמך PDF]'}\\n\\n--- תוכן שחולץ (הטקסט ייתכן שמוצג הפוך) ---\\n${pdfData.text.substring(0, 10000)}`;
                     console.log('[VISION] Proceeding with extracted PDF text.');
                  }
                } catch (textErr) {}
              }
            }"""

content = content.replace(old_pdf_block, new_pdf_block)

# Replace the GPT-4.1 block
gpt41_pattern = re.compile(r"if \(fileData\?\.type === 'pdf_native'\) \{.*?\} else if \(fileData\) \{", re.DOTALL)
content = gpt41_pattern.sub("if (fileData) {", content)

# Remove model: 'gpt-4.1' and use gpt-4o-mini
content = content.replace("model: 'gpt-4.1',", "model: 'gpt-4o-mini',")

with open('src/app/api/webhook/route.ts', 'w') as f:
    f.write(content)
