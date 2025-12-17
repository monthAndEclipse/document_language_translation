
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

// Handle ES module import structure for pdfjs-dist (esm.sh often wraps it in default)
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// Set worker source for pdfjs-dist
if (pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Helper to escape HTML characters for plain text fallback
const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const validatePdfIsProgrammatic = async (file: File): Promise<boolean> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer.slice(0) });
    const pdf = await loadingTask.promise;
    
    const numPagesToCheck = Math.min(pdf.numPages, 3);
    let totalTextLength = 0;

    for (let i = 1; i <= numPagesToCheck; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join('');
      totalTextLength += pageText.trim().length;
    }

    return totalTextLength > 50;
  } catch (e) {
    console.error("Error validating PDF:", e);
    return false;
  }
};

export interface ParseResult {
  html: string;
  pageCount: number;
}

export const parseFileToHtml = async (file: File): Promise<ParseResult> => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const fileType = file.type;

  try {
    // DOCX Handling
    if (extension === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      return { html: `<div class="docx-content">${result.value}</div>`, pageCount: 0 };
    } 
    
    // XLSX Handling
    else if (extension === 'xlsx' || extension === 'xls') {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      let html = '<div class="xlsx-content">';
      
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const sheetHtml = XLSX.utils.sheet_to_html(sheet);
        html += `<div class="sheet-wrapper"><h3 class="sheet-title">${sheetName}</h3>${sheetHtml}</div>`;
      });
      
      html += '</div>';
      return { html, pageCount: 0 };
    }
    
    // PPTX Handling
    else if (extension === 'pptx') {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const slideFiles = Object.keys(zip.files).filter(name => name.match(/ppt\/slides\/slide\d+\.xml/));
      
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0');
        return numA - numB;
      });

      let fullHtml = '<div class="pptx-content">';
      const parser = new DOMParser();

      for (const fileName of slideFiles) {
        const xmlText = await zip.files[fileName].async('string');
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const textNodes = xmlDoc.getElementsByTagName('a:t');
        
        let slideContent = '';
        for (let i = 0; i < textNodes.length; i++) {
          slideContent += `<p>${escapeHtml(textNodes[i].textContent || '')}</p>`;
        }
        
        if (slideContent.trim()) {
            const slideNum = fileName.match(/slide(\d+)/)?.[1];
            fullHtml += `<div class="slide-card"><div class="slide-number">Slide ${slideNum}</div>${slideContent}</div>`;
        }
      }
      fullHtml += '</div>';
      return { html: fullHtml, pageCount: slideFiles.length };
    }

    // PDF Handling
    else if (extension === 'pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer.slice(0) });
      const pdf = await loadingTask.promise;
      
      let fullHtml = '<div class="pdf-content">';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Reconstruct text with proper line breaks
        let pageText = '';
        textContent.items.forEach((item: any) => {
             // pdf.js items are fragments. hasEOL indicates a hard break.
             pageText += item.str + (item.hasEOL ? '\n' : ' ');
        });

        // Normalize spaces
        pageText = pageText.replace(/  +/g, ' ');

        // Split into paragraphs to ensure we generate multiple segments per page
        // This prevents creating one massive segment that might timeout or get truncated
        const paragraphs = pageText.split('\n').filter(line => line.trim().length > 0);
        
        let pageContent = '';
        if (paragraphs.length > 0) {
            paragraphs.forEach(p => {
                pageContent += `<p>${escapeHtml(p)}</p>`;
            });
        } else {
             pageContent = `<span class="text-gray-300 italic">Empty Page</span>`;
        }
        
        fullHtml += `<div class="pdf-page" data-page="${i}"><div class="page-number">Page ${i}</div>${pageContent}</div>`;
      }
      fullHtml += '</div>';
      return { html: fullHtml, pageCount: pdf.numPages };
    }

    // Generic XML / Plain Text
    else if (extension === 'xml' || fileType === 'text/xml' || fileType === 'application/xml') {
        const text = await file.text();
        return { html: `<pre class="xml-content">${escapeHtml(text)}</pre>`, pageCount: 0 };
    }

    // Default Text Handling
    else {
      const text = await file.text();
      return { html: `<div class="text-content">${escapeHtml(text).replace(/\n/g, '<br/>')}</div>`, pageCount: 0 };
    }
  } catch (err) {
    console.error(`Error parsing file ${file.name}:`, err);
    return { html: `<div class="error-parse">Error parsing file content: ${(err as any).message}</div>`, pageCount: 0 };
  }
};
