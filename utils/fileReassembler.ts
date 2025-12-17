
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
// @ts-ignore
import fontkit from '@pdf-lib/fontkit';
import { Segment } from '../types';

export const reassembleFile = async (originalFile: File, segments: Segment[]): Promise<Blob> => {
  const extension = originalFile.name.split('.').pop()?.toLowerCase();
  
  // Create a cleanup map for fast lookups: Original Text -> Translated Text
  // We trim keys to improve matching success rate
  const translationMap = new Map<string, string>();
  segments.forEach(seg => {
    if (seg.translated && seg.original) {
      translationMap.set(seg.original.trim(), seg.translated);
    }
  });

  try {
    if (extension === 'docx') {
      return await reassembleDocx(originalFile, translationMap);
    } else if (extension === 'pptx') {
      return await reassemblePptx(originalFile, translationMap);
    } else if (extension === 'xlsx' || extension === 'xls') {
      return await reassembleXlsx(originalFile, translationMap);
    } else if (extension === 'pdf') {
      // Use the dedicated PDF reassembler that iterates segments
      return await reassemblePdf(segments);
    } else {
      // Fallback for text-based files (txt, md, xml)
      return await reassembleText(originalFile, translationMap);
    }
  } catch (error) {
    console.error("Error reassembling file:", error);
    throw new Error("Failed to generate download file");
  }
};

// Helper to check if a node contains meaningful content (alphanumeric/symbols), not just whitespace or underscores
const hasMeaningfulContent = (text: string): boolean => {
  // Matches any character that is NOT whitespace and NOT an underscore
  return /[^\s_]/.test(text);
};

// Helper to detect if character is CJK (Chinese, Japanese, Korean) or Fullwidth
const isCJK = (char: string) => {
    const code = char.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
           (code >= 0x3000 && code <= 0x303F) || // CJK Symbols and Punctuation
           (code >= 0xFF00 && code <= 0xFFEF) || // Fullwidth Forms
           (code >= 0xAC00 && code <= 0xD7AF);   // Hangul Syllables
};

const reassembleDocx = async (file: File, translationMap: Map<string, string>): Promise<Blob> => {
  const zip = await JSZip.loadAsync(file);
  // Word stores text primarily in document.xml, but also headers/footers
  const xmlFiles = Object.keys(zip.files).filter(path => 
    path.match(/word\/document\.xml/) || 
    path.match(/word\/header\d+\.xml/) || 
    path.match(/word\/footer\d+\.xml/)
  );

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const path of xmlFiles) {
    const xmlContent = await zip.file(path)?.async("string");
    if (!xmlContent) continue;

    const doc = parser.parseFromString(xmlContent, "application/xml");
    
    // Pass 1: Try exact matching individual text nodes
    const allTextNodes = Array.from(doc.getElementsByTagName("w:t"));
    for (const node of allTextNodes) {
      const text = node.textContent || '';
      const key = text.trim();
      
      if (key && translationMap.has(key)) {
        node.textContent = translationMap.get(key)!;
        node.setAttribute('xml:space', 'preserve'); // Ensure spaces are kept
        node.setAttribute('data-translated', 'true');
      }
    }

    // Pass 2: Paragraph Aggregation for Split Runs
    // Word often splits text into multiple <w:t> tags (runs) within a paragraph <w:p>
    const paragraphs = doc.getElementsByTagName("w:p");
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        // Get unhandled text nodes in this paragraph
        const runNodes = Array.from(p.getElementsByTagName("w:t"))
                             .filter(n => !n.getAttribute('data-translated'));
        
        if (runNodes.length <= 1) continue; 

        // Reconstruct full text of the paragraph to see if it matches a segment
        const fullText = runNodes.map(n => n.textContent).join('');
        const trimmedFull = fullText.trim();

        if (translationMap.has(trimmedFull)) {
             const translated = translationMap.get(trimmedFull)!;
             
             // STRATEGY: Find the "Dominant Node"
             // Priority 1: Nodes that contain actual content (letters, numbers, symbols)
             // Priority 2: Length of the content
             
             // This prevents "formatting placeholders" (like runs of just underscores or spaces with underlines)
             // from being selected as the container for the whole sentence, which would cause style bleeding.
             
             const contentNodes = runNodes.filter(n => hasMeaningfulContent(n.textContent || ''));
             // If we found content nodes, only consider those. Otherwise fallback to all (e.g. if the whole line is just ____)
             const candidateNodes = contentNodes.length > 0 ? contentNodes : runNodes;

             let maxLen = -1;
             let dominantNode = candidateNodes[0];

             candidateNodes.forEach(node => {
                const len = (node.textContent || '').length;
                if (len > maxLen) {
                  maxLen = len;
                  dominantNode = node;
                }
             });

             // Put the translated text in the dominant node
             dominantNode.textContent = translated;
             dominantNode.setAttribute('xml:space', 'preserve');
             dominantNode.setAttribute('data-translated', 'true');
             
             // Clear the text from other nodes
             runNodes.forEach(node => {
               if (node !== dominantNode) {
                 node.textContent = '';
                 node.setAttribute('data-translated', 'true');
               }
             });
        }
    }

    // Cleanup markers
    const cleanedNodes = doc.getElementsByTagName("w:t");
    for(let i=0; i<cleanedNodes.length; i++) {
        cleanedNodes[i].removeAttribute('data-translated');
    }

    const newXml = serializer.serializeToString(doc);
    zip.file(path, newXml);
  }

  return await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
};

const reassemblePptx = async (file: File, translationMap: Map<string, string>): Promise<Blob> => {
  const zip = await JSZip.loadAsync(file);
  // PowerPoint stores text in slide xmls
  const xmlFiles = Object.keys(zip.files).filter(path => path.match(/ppt\/slides\/slide\d+\.xml/));

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const path of xmlFiles) {
    const xmlContent = await zip.file(path)?.async("string");
    if (!xmlContent) continue;

    const doc = parser.parseFromString(xmlContent, "application/xml");
    
    // Pass 1: Individual nodes (<a:t> in PowerPoint)
    const allTextNodes = Array.from(doc.getElementsByTagName("a:t"));
    for (const node of allTextNodes) {
      const text = node.textContent || '';
      const key = text.trim();

      if (key && translationMap.has(key)) {
        node.textContent = translationMap.get(key)!;
        node.setAttribute('data-translated', 'true');
      }
    }

    // Pass 2: Paragraph Aggregation (<a:p>)
    const paragraphs = doc.getElementsByTagName("a:p");
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const runNodes = Array.from(p.getElementsByTagName("a:t"))
                             .filter(n => !n.getAttribute('data-translated'));
        
        if (runNodes.length <= 1) continue;

        const fullText = runNodes.map(n => n.textContent).join('');
        const trimmedFull = fullText.trim();

        if (translationMap.has(trimmedFull)) {
             const translated = translationMap.get(trimmedFull)!;
             
             // Dominant Node Strategy for PPTX as well
             const contentNodes = runNodes.filter(n => hasMeaningfulContent(n.textContent || ''));
             const candidateNodes = contentNodes.length > 0 ? contentNodes : runNodes;

             let maxLen = -1;
             let dominantNode = candidateNodes[0];

             candidateNodes.forEach(node => {
                const len = (node.textContent || '').length;
                if (len > maxLen) {
                  maxLen = len;
                  dominantNode = node;
                }
             });

             dominantNode.textContent = translated;
             dominantNode.setAttribute('data-translated', 'true');
             
             runNodes.forEach(node => {
               if (node !== dominantNode) {
                 node.textContent = '';
                 node.setAttribute('data-translated', 'true');
               }
             });
        }
    }

    // Cleanup markers
    const cleanedNodes = doc.getElementsByTagName("a:t");
    for(let i=0; i<cleanedNodes.length; i++) {
        cleanedNodes[i].removeAttribute('data-translated');
    }

    const newXml = serializer.serializeToString(doc);
    zip.file(path, newXml);
  }

  return await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
};

const reassembleXlsx = async (file: File, translationMap: Map<string, string>): Promise<Blob> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    
    // Iterate over all keys in the sheet object
    Object.keys(sheet).forEach(cellKey => {
      // Skip internal keys starting with !
      if (cellKey.startsWith('!')) return;

      const cell = sheet[cellKey];
      // Check if cell has a string value (type 's' or just checking .v)
      if (cell && cell.v && typeof cell.v === 'string') {
        const key = cell.v.trim();
        if (translationMap.has(key)) {
          cell.v = translationMap.get(key);
          // If the cell type was string, we update it. 
          // Note: formatted text (rich text) in Excel is more complex, this handles standard cells.
        }
      }
    });
  });

  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

// Generates a new PDF with translated text, structured by Original Page
const reassemblePdf = async (segments: Segment[]): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();
    
    // Register fontkit to support custom fonts
    pdfDoc.registerFontkit(fontkit);

    // Fetch and embed a font that supports CJK characters
    // Using Noto Sans SC (Simplified Chinese) from a CDN
    let font;
    try {
        const fontUrl = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf';
        const fontBytes = await fetch(fontUrl).then(res => {
            if (!res.ok) throw new Error("Failed to fetch font");
            return res.arrayBuffer();
        });
        font = await pdfDoc.embedFont(fontBytes);
    } catch (e) {
        console.warn("Failed to load CJK font, falling back to Standard Font (CJK characters will not render)", e);
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    
    const fontSize = 11;
    const lineHeight = fontSize + 6;
    const margin = 50;

    // Group segments by page number
    const pagesMap = new Map<number, Segment[]>();
    segments.forEach(seg => {
        const pNum = seg.pageNumber ?? 1;
        if (!pagesMap.has(pNum)) {
            pagesMap.set(pNum, []);
        }
        pagesMap.get(pNum)!.push(seg);
    });

    const sortedPageNums = Array.from(pagesMap.keys()).sort((a, b) => a - b);

    // Initial Page
    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let y = height - margin;

    const addNewPage = () => {
        page = pdfDoc.addPage();
        y = height - margin;
    };

    for (const pageNum of sortedPageNums) {
        const pageSegments = pagesMap.get(pageNum)!;
        
        // Add a visual separator/header for the page
        if (y < height - margin) {
            y -= 10;
        }
        
        if (y < margin + 40) addNewPage();

        // Draw Header "Original Page X"
        page.drawText(`--- Original Page ${pageNum} ---`, {
            x: margin,
            y: y,
            size: 9,
            font,
            color: rgb(0.5, 0.5, 0.5)
        });
        y -= 20;

        for (const seg of pageSegments) {
            const text = seg.translated || seg.original;
            if (!text) continue;

            const paragraphs = text.split('\n');
            
            for (const para of paragraphs) {
                 if (!para.trim()) {
                     y -= lineHeight / 2; // Half line spacing for empty para
                     if (y < margin) addNewPage();
                     continue;
                 }

                 let currentLine = '';
                 let currentLineWidth = 0;
                 const maxWidth = width - (margin * 2);

                 // Improved Text Wrapping (CJK & Latin)
                 for (let i = 0; i < para.length; i++) {
                    let char = para[i];
                    let token = char;
                    
                    // If Latin, grab the whole word to prevent breaking inside a word
                    if (!isCJK(char) && char !== ' ') {
                        let j = i + 1;
                        while (j < para.length) {
                             const nextChar = para[j];
                             if (isCJK(nextChar) || nextChar === ' ') break;
                             token += nextChar;
                             j++;
                        }
                        i = j - 1; // Advance outer loop
                    }

                    const tokenWidth = font.widthOfTextAtSize(token, fontSize);
                    
                    if (currentLineWidth + tokenWidth > maxWidth) {
                        // Draw current line
                        page.drawText(currentLine, { x: margin, y, size: fontSize, font });
                        y -= lineHeight;
                        if (y < margin) addNewPage();
                        
                        // Start new line
                        if (token.trim().length === 0) {
                             currentLine = '';
                             currentLineWidth = 0;
                        } else {
                             currentLine = token;
                             currentLineWidth = tokenWidth;
                        }
                    } else {
                        currentLine += token;
                        currentLineWidth += tokenWidth;
                    }
                 }

                 if (currentLine) {
                     page.drawText(currentLine, { x: margin, y, size: fontSize, font });
                     y -= lineHeight;
                 }
                 
                 // Paragraph Spacing
                 y -= (lineHeight * 0.5);
                 if (y < margin) addNewPage();
            }
            
            // Extra spacing between segments
            y -= 2;
            if (y < margin) addNewPage();
        }
        
        // Page break spacing
        y -= 20;
        if (y < margin) addNewPage();
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

const reassembleText = async (file: File, translationMap: Map<string, string>): Promise<Blob> => {
  let content = await file.text();
  translationMap.forEach((translated, original) => {
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(escapedOriginal, 'g'), translated);
  });
  return new Blob([content], { type: file.type });
};
