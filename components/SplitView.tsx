
import React, { useRef, useMemo } from 'react';
import { Segment, PageRange } from '../types';

interface SplitViewProps {
  segments: Segment[];
  htmlContent?: string;
  isLoading: boolean;
  selectedRange?: PageRange; // New prop to filter view
}

export const SplitView: React.FC<SplitViewProps> = ({ segments, htmlContent, isLoading, selectedRange }) => {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef<'left' | 'right' | null>(null);

  // Synchronized Scrolling
  const handleScroll = (source: 'left' | 'right') => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    if (isScrolling.current && isScrolling.current !== source) return;

    isScrolling.current = source;
    
    if (source === 'left') {
      right.scrollTop = left.scrollTop;
    } else {
      left.scrollTop = right.scrollTop;
    }

    setTimeout(() => {
      isScrolling.current = null;
    }, 50);
  };

  const { sourceHtml, targetHtml, styles } = useMemo(() => {
    if (!htmlContent) return { sourceHtml: '', targetHtml: '', styles: '' };

    const parser = new DOMParser();

    // 1. Prepare Styles for Page Filtering
    let customStyles = '';
    if (selectedRange) {
        // Hide all pages by default
        customStyles += `.pdf-page { display: none !important; }`;
        // Show only pages in range
        for (let i = selectedRange.start; i <= selectedRange.end; i++) {
            customStyles += `.pdf-page[data-page="${i}"] { display: block !important; }`;
        }
    }

    // 2. Prepare Target HTML
    const targetDoc = parser.parseFromString(htmlContent, 'text/html');
    
    segments.forEach(seg => {
      const el = targetDoc.getElementById(seg.id);
      
      if (el) {
        if (seg.translated) {
          el.textContent = seg.translated;
          el.classList.add('translated-completed');
          el.classList.remove('translated-hidden', 'translated-loading');
        } else if (seg.status === 'translating') {
           el.classList.add('translated-loading');
           el.classList.remove('translated-hidden', 'translated-completed');
        } else {
           el.classList.add('translated-hidden');
           el.classList.remove('translated-completed', 'translated-loading');
        }
      }
    });

    return {
      sourceHtml: htmlContent, 
      targetHtml: targetDoc.body.innerHTML,
      styles: customStyles
    };
  }, [htmlContent, segments, selectedRange]);

  if (!htmlContent && !isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-gray-400 italic">
          No content to display
        </div>
      );
  }

  return (
    <div className="flex h-full border rounded-md overflow-hidden bg-white shadow-sm relative">
      {/* Dynamic Style injection for hiding filtered pages */}
      {styles && <style>{styles}</style>}

      {/* Source Panel */}
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 font-medium text-gray-700 text-sm sticky top-0 z-10 flex justify-between">
          <span>Source</span>
          {selectedRange && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">Pages {selectedRange.start}-{selectedRange.end}</span>}
        </div>
        <div 
          ref={leftRef}
          onScroll={() => handleScroll('left')}
          className="flex-1 overflow-y-auto p-6 scroll-smooth document-view"
        >
          <div dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        </div>
      </div>

      {/* Target Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F7F8FA]">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 font-medium text-gray-700 text-sm sticky top-0 z-10 flex justify-between">
          <span>Target</span>
          {selectedRange && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">Pages {selectedRange.start}-{selectedRange.end}</span>}
        </div>
        <div 
          ref={rightRef}
          onScroll={() => handleScroll('right')}
          className="flex-1 overflow-y-auto p-6 scroll-smooth document-view"
        >
          <div dangerouslySetInnerHTML={{ __html: targetHtml }} />
        </div>
      </div>
    </div>
  );
};
