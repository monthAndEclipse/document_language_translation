
import { MessageType, WebSocketMessage, Segment, FileJob, PageRange } from '../types';
import { translateTextSegment } from './geminiService';
import { parseFileToHtml } from '../utils/fileParser';
import { reassembleFile } from '../utils/fileReassembler';

// Helper to tokenize HTML string into text segments
function tokenizeHtml(html: string, fileId: string): { html: string, segments: Segment[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const segments: Segment[] = [];
  let index = 0;

  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text && text.trim().length > 0) {
        const segId = `seg-${fileId}-${index}`;
        
        // Detect Page Number from closest parent
        let pageNumber: number | undefined = undefined;
        let parent = node.parentNode; // Use parentNode for wider compatibility
        
        while (parent && parent.nodeType === Node.ELEMENT_NODE) {
          const el = parent as Element;
          if (el.hasAttribute('data-page')) {
            const val = el.getAttribute('data-page');
            if (val) {
                pageNumber = parseInt(val, 10);
            }
            break;
          }
          parent = parent.parentNode;
        }

        const span = doc.createElement('span');
        span.id = segId;
        span.className = 'translatable-segment';
        span.textContent = text;
        
        node.parentNode?.replaceChild(span, node);

        segments.push({
          id: segId,
          index: index,
          original: text, 
          translated: '',
          status: 'pending',
          pageNumber: pageNumber
        });
        index++;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tagName = el.tagName.toLowerCase();
      if (tagName !== 'script' && tagName !== 'style') {
        // Create a static array of children to avoid issues when replacing nodes during traversal
        Array.from(node.childNodes).forEach(traverse);
      }
    }
  }

  traverse(doc.body);
  
  return { 
    html: doc.body.innerHTML, 
    segments 
  };
}

export class MockBackend {
  // Renamed to match usage in App.tsx (or export alias) - keeping MockTranslationBackend class name for consistency with imports
}

export class MockTranslationBackend {
  private listeners: ((msg: WebSocketMessage) => void)[] = [];
  private batchId: string = `batch-${Date.now()}`;
  private jobs: Map<string, FileJob> = new Map();
  private fileStorage: Map<string, File> = new Map(); 
  
  private fileQueue: string[] = [];
  private isProcessingFile: boolean = false;

  constructor() {}

  public connect(onMessage: (msg: WebSocketMessage) => void) {
    this.listeners.push(onMessage);
    setTimeout(() => {
      this.broadcast({ type: MessageType.BATCH_INIT, batchId: this.batchId });
    }, 500);
  }

  public async uploadFile(file: File, sourceLang: string, targetLang: string) {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      this.fileStorage.set(fileId, file);

      // 1. Convert File to formatted HTML (now includes pageCount)
      const { html: rawHtml, pageCount } = await parseFileToHtml(file);

      // 2. Tokenize HTML
      const { html: processedHtml, segments } = tokenizeHtml(rawHtml, fileId);

      const job: FileJob = {
        id: fileId,
        name: file.name,
        type: file.type,
        size: file.size,
        status: 'idle',
        progress: 0,
        segments,
        htmlContent: processedHtml,
        sourceLang,
        targetLang,
        pageCount: pageCount > 0 ? pageCount : undefined
      };

      this.jobs.set(fileId, job);

      this.broadcast({
        type: MessageType.FILE_READY,
        fileId,
        batchId: this.batchId,
        payload: { job } 
      });

    } catch (error) {
      console.error("Upload failed", error);
    }
  }

  public startProcessing(fileId: string, range?: PageRange) {
    const job = this.jobs.get(fileId);
    if (!job || job.status !== 'idle') return;

    job.status = 'queued';
    // Store the user selected range (strictly 5-15, for example)
    if (range) {
      job.selectedRange = range;
    }
    
    this.broadcast({
        type: MessageType.FILE_PROGRESS,
        fileId,
        payload: { progress: 0, status: 'queued', selectedRange: range } // Broadcast range update
    });

    this.fileQueue.push(fileId);
    this.processQueue();
  }

  public deleteFile(fileId: string) {
    if (this.jobs.has(fileId)) {
      this.jobs.delete(fileId);
    }
    if (this.fileStorage.has(fileId)) {
      this.fileStorage.delete(fileId);
    }
    this.fileQueue = this.fileQueue.filter(id => id !== fileId);
  }

  public clearAll() {
    this.jobs.clear();
    this.fileStorage.clear();
    this.fileQueue = [];
  }

  public async generateDownload(fileId: string): Promise<Blob | null> {
    const job = this.jobs.get(fileId);
    const originalFile = this.fileStorage.get(fileId);

    if (!job || !originalFile) {
      console.error("File not found for download");
      return null;
    }

    try {
      // Filter segments: Only include those strictly within the selected range (e.g., 5-15)
      // Exclude the buffer pages (4 and 16) from the final download
      let segmentsToDownload = job.segments;
      if (job.selectedRange) {
        segmentsToDownload = job.segments.filter(s => {
          if (s.pageNumber === undefined) return true; // Keep if page unknown
          return s.pageNumber >= job.selectedRange!.start && s.pageNumber <= job.selectedRange!.end;
        });
      }

      return await reassembleFile(originalFile, segmentsToDownload);
    } catch (e) {
      console.error("Reassembly failed", e);
      return null;
    }
  }

  private async processQueue() {
    if (this.isProcessingFile || this.fileQueue.length === 0) return;

    this.isProcessingFile = true;
    const fileId = this.fileQueue.shift();

    if (fileId) {
      await this.processFile(fileId);
    }

    this.isProcessingFile = false;
    if (this.fileQueue.length > 0) {
      this.processQueue();
    }
  }

  private async processFile(fileId: string) {
    const job = this.jobs.get(fileId);
    if (!job) return;

    job.status = 'processing';
    this.broadcast({
      type: MessageType.FILE_PROGRESS,
      fileId,
      payload: { progress: 0, status: 'processing' }
    });

    // Determine Translation Scope (Range + Buffer)
    // If user selected 5-15, we translate 4-16 (buffer 1 page)
    let segmentsToProcess = job.segments;
    let totalWorkSegments = job.segments.length;

    if (job.selectedRange && job.pageCount) {
       const bufferStart = Math.max(1, job.selectedRange.start - 1);
       const bufferEnd = Math.min(job.pageCount, job.selectedRange.end + 1);
       
       segmentsToProcess = job.segments.filter(s => {
         // If page detection worked, pageNumber is set.
         // If undefined, it means it's outside our page structure or detection failed.
         // For PDF range mode, strictly filter.
         if (s.pageNumber === undefined) return false; 
         return s.pageNumber >= bufferStart && s.pageNumber <= bufferEnd;
       });
       
       totalWorkSegments = segmentsToProcess.length;
    }

    let completedWorkSegments = 0;

    if (totalWorkSegments === 0) {
        job.status = 'completed';
        job.progress = 100;
        this.broadcast({
            type: MessageType.FILE_COMPLETE,
            fileId,
            payload: { job }
        });
        this.checkBatchCompletion();
        return;
    }

    const MAX_BATCH_CHARS = 2000; 
    const DELIMITER = " ||| ";
    
    let currentBatch: Segment[] = [];
    let currentBatchCharCount = 0;

    for (let i = 0; i < totalWorkSegments; i++) {
      const segment = segmentsToProcess[i];
      
      currentBatch.push(segment);
      currentBatchCharCount += segment.original.length;

      const isBatchFull = currentBatchCharCount >= MAX_BATCH_CHARS;
      const isLastSegment = i === totalWorkSegments - 1;

      if (isBatchFull || isLastSegment) {
        segment.status = 'translating';
        currentBatch.forEach(s => {
             this.broadcast({
              type: MessageType.SEGMENT_TRANSLATION, 
              fileId,
              segmentId: s.id,
              index: s.index,
              payload: { 
                translated: '', 
                original: s.original,
                status: 'translating' 
              }
            });
        });

        try {
          const textToTranslate = currentBatch.map(s => s.original).join(DELIMITER);
          
          await new Promise(r => setTimeout(r, 6000)); // Rate limiting simulation
          
          const translatedBlock = await translateTextSegment(textToTranslate, job.targetLang);
          const splitRegex = /\s*\|\|\|\s*/;
          const translatedParts = translatedBlock.split(splitRegex);

          currentBatch.forEach((batchSeg, index) => {
            const trans = translatedParts[index] ? translatedParts[index].trim() : "";
            batchSeg.translated = trans || batchSeg.original; 
            batchSeg.status = 'completed';

            this.broadcast({
              type: MessageType.SEGMENT_TRANSLATION,
              fileId,
              segmentId: batchSeg.id,
              index: batchSeg.index,
              payload: { 
                translated: batchSeg.translated,
                original: batchSeg.original
              }
            });
          });

        } catch (error) {
          console.error("Batch translation failed:", error);
          currentBatch.forEach(batchSeg => {
            batchSeg.status = 'warning';
            batchSeg.warningMessage = 'Translation failed';
            
            this.broadcast({
              type: MessageType.SEGMENT_WARNING,
              fileId,
              segmentId: batchSeg.id,
              index: batchSeg.index,
              payload: { message: batchSeg.warningMessage }
            });
          });
        }

        completedWorkSegments += currentBatch.length;
        const progress = Math.round((completedWorkSegments / totalWorkSegments) * 100);
        this.broadcast({
          type: MessageType.FILE_PROGRESS,
          fileId,
          payload: { progress }
        });

        currentBatch = [];
        currentBatchCharCount = 0;
      }
    }

    job.status = 'completed';
    job.progress = 100;
    this.broadcast({
      type: MessageType.FILE_COMPLETE,
      fileId,
      payload: { job }
    });

    this.checkBatchCompletion();
  }

  private checkBatchCompletion() {
    const allComplete = Array.from(this.jobs.values()).every(j => j.status === 'completed' || j.status === 'error' || j.status === 'idle');
    if (allComplete && this.jobs.size > 0) {
      this.broadcast({ type: MessageType.BATCH_COMPLETE, batchId: this.batchId });
    }
  }

  private broadcast(msg: WebSocketMessage) {
    this.listeners.forEach(l => l(msg));
  }
}
