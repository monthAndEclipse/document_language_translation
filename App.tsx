
import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileJob, 
  MessageType, 
  SupportedLocale, 
  WebSocketMessage 
} from './types';
import { MockTranslationBackend } from './services/mockBackend';
import { FileList } from './components/FileList';
import { SplitView } from './components/SplitView';
import { FileUpload } from './components/FileUpload';
import { Button } from './components/Button';
import { Toast } from './components/Toast';
import { TARGET_LANGUAGES } from './constants';
import { t } from './utils/i18n';
import { validatePdfIsProgrammatic } from './utils/fileParser';
import { Languages, Download, Settings, Play, Layers } from 'lucide-react';

const App: React.FC = () => {
  const [backend] = useState(() => new MockTranslationBackend());
  const [locale, setLocale] = useState<SupportedLocale>(SupportedLocale.EN);
  const [targetLang, setTargetLang] = useState<string>('en-US');
  const [isDownloading, setIsDownloading] = useState(false);
  
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  
  // Page Range State
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');
  
  // Toast State
  const [toastMessage, setToastMessage] = useState('');
  const [isToastVisible, setIsToastVisible] = useState(false);

  // Computed state
  const activeJob = jobs.find(j => j.id === selectedFileId);

  // Reset page inputs when active file changes
  useEffect(() => {
    // We only want to reset or load range when the selected FILE changes.
    // If the activeJob updates (e.g. progress), we don't want to wipe the user's input.
    if (activeJob) {
        if (activeJob.selectedRange) {
            setRangeStart(activeJob.selectedRange.start.toString());
            setRangeEnd(activeJob.selectedRange.end.toString());
        } else {
            // Only clear if we just switched to this file and it has no range set
            // Since we can't easily detect "switch" vs "update" without refs, 
            // we rely on the fact that we only clear if rangeStart/End were populated for a different file.
            // But simplify: assume user wants clean slate on file switch if no range exists.
            setRangeStart('');
            setRangeEnd('');
        }
    } else {
        setRangeStart('');
        setRangeEnd('');
    }
  }, [selectedFileId]); // Critical: Removed activeJob/activeJob.selectedRange from deps to prevent overwriting user input during status updates

  const handleMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case MessageType.BATCH_INIT:
        console.log('Batch initialized:', msg.batchId);
        break;

      case MessageType.FILE_READY:
        if (msg.payload?.job) {
          setJobs(prev => [...prev, msg.payload.job]);
          setSelectedFileId(msg.fileId || null);
        }
        break;

      case MessageType.FILE_PROGRESS:
        setJobs(prev => prev.map(job => {
          if (job.id === msg.fileId) {
            return { 
              ...job, 
              progress: msg.payload.progress,
              status: msg.payload.status || job.status,
              selectedRange: msg.payload.selectedRange || job.selectedRange // Update range if broadcast
            };
          }
          return job;
        }));
        break;

      case MessageType.SEGMENT_TRANSLATION:
        setJobs(prev => prev.map(job => {
          if (job.id === msg.fileId) {
            const newSegments = [...job.segments];
            const segIndex = newSegments.findIndex(s => s.id === msg.segmentId);
            if (segIndex !== -1) {
              if (msg.payload.status === 'translating') {
                 newSegments[segIndex] = {
                  ...newSegments[segIndex],
                  status: 'translating'
                 }
              } else {
                newSegments[segIndex] = {
                  ...newSegments[segIndex],
                  translated: msg.payload.translated,
                  status: 'completed'
                };
              }
            }
            return { ...job, segments: newSegments };
          }
          return job;
        }));
        break;
      
      case MessageType.SEGMENT_WARNING:
         setJobs(prev => prev.map(job => {
          if (job.id === msg.fileId) {
            const newSegments = [...job.segments];
            const segIndex = newSegments.findIndex(s => s.id === msg.segmentId);
            if (segIndex !== -1) {
              newSegments[segIndex] = {
                ...newSegments[segIndex],
                status: 'warning',
                warningMessage: msg.payload.message
              };
            }
            return { ...job, segments: newSegments };
          }
          return job;
        }));
        break;

      case MessageType.FILE_COMPLETE:
        setJobs(prev => prev.map(job => {
          if (job.id === msg.fileId) {
            return { ...job, status: 'completed', progress: 100 };
          }
          return job;
        }));
        break;

      default:
        break;
    }
  }, []);

  useEffect(() => {
    backend.connect(handleMessage);
  }, [backend, handleMessage]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setIsToastVisible(true);
  };

  const handleUpload = async (files: FileList) => {
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const isValid = await validatePdfIsProgrammatic(file);
        if (!isValid) {
          showToast(`Skipped ${file.name}: Only programmatic PDFs are supported. Scanned PDFs are not allowed.`);
          continue;
        }
      }
      backend.uploadFile(file, 'auto', targetLang);
    }
  };

  const handleStartAll = () => {
    jobs.forEach(job => {
      if (job.status === 'idle') {
        backend.startProcessing(job.id);
      }
    });
  };

  const handleStartOne = (id: string) => {
    // If it's the active file and is a PDF, use the local state range
    const job = jobs.find(j => j.id === id);
    if (job && job.pageCount && id === activeJob?.id && rangeStart && rangeEnd) {
        const start = parseInt(rangeStart);
        const end = parseInt(rangeEnd);
        
        if (start > 0 && end >= start && end <= job.pageCount) {
             backend.startProcessing(id, { start, end });
             return;
        } else {
            showToast(`Invalid page range. Please select between 1 and ${job.pageCount}`);
            return;
        }
    }
    
    // Default processing (all pages)
    backend.startProcessing(id);
  };

  const handleDeleteOne = (id: string) => {
    backend.deleteFile(id);
    setJobs(prev => prev.filter(job => job.id !== id));
    if (selectedFileId === id) {
      setSelectedFileId(null);
    }
  };

  const handleDeleteAll = () => {
    backend.clearAll();
    setJobs([]);
    setSelectedFileId(null);
  };

  const handleDownload = async () => {
    if (!activeJob) return;
    
    setIsDownloading(true);
    try {
      const blob = await backend.generateDownload(activeJob.id);
      
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const parts = activeJob.name.split('.');
        const ext = parts.pop();
        const name = parts.join('.');
        
        const suffix = activeJob.selectedRange ? `_pages_${activeJob.selectedRange.start}-${activeJob.selectedRange.end}` : '';
        a.download = `${name}_${activeJob.targetLang}${suffix}.${ext}`;
        
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert("Failed to generate download. Please try again.");
      }
    } catch (e) {
      console.error(e);
      alert("Error generating download file.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#F7F8FA] text-gray-900 font-sans">
      <Toast 
        message={toastMessage} 
        isVisible={isToastVisible} 
        onClose={() => setIsToastVisible(false)} 
      />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 h-16 px-6 flex items-center justify-between shrink-0 z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600 p-1.5 rounded text-white">
            <Languages size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-800">
            {t('appTitle', locale)}
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
             <label className="text-sm font-medium text-gray-600 hidden md:block">UI Language:</label>
             <select 
               className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 p-1.5 bg-gray-50"
               value={locale}
               onChange={(e) => setLocale(e.target.value as SupportedLocale)}
             >
                <option value="en">English</option>
                <option value="zh-CN">中文 (简体)</option>
                <option value="zh-TW">中文 (繁體)</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
             </select>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 overflow-hidden p-6 flex flex-col md:flex-row gap-6">
        
        {/* Left Sidebar */}
        <aside className="w-full md:w-80 flex flex-col space-y-6 shrink-0">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('source', locale)}</label>
              <div className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded text-gray-500 text-sm">
                 {t('autoDetect', locale)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('target', locale)}</label>
              <select
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
              >
                {TARGET_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>
            
            <FileUpload onUpload={handleUpload} locale={locale} />
          </div>

          <div className="flex-1 min-h-0">
            <FileList 
              files={jobs} 
              selectedFileId={selectedFileId} 
              onSelectFile={setSelectedFileId} 
              onStartAll={handleStartAll}
              onStartOne={handleStartOne}
              onDeleteOne={handleDeleteOne}
              onDeleteAll={handleDeleteAll}
            />
          </div>
        </aside>

        {/* Right Area */}
        <section className="flex-1 flex flex-col min-w-0 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {activeJob ? (
            <>
              {/* Toolbar */}
              <div className="h-16 border-b border-gray-200 px-4 flex items-center justify-between bg-white shrink-0">
                <div className="flex flex-col justify-center">
                  <div className="flex items-center space-x-2">
                    <h2 className="font-semibold text-gray-800 truncate max-w-xs md:max-w-md">
                      {activeJob.name}
                    </h2>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                      activeJob.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                      activeJob.status === 'processing' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                      activeJob.status === 'idle' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                      'bg-gray-100 text-gray-600 border-gray-200'
                    }`}>
                      {activeJob.status === 'idle' ? 'Ready' : activeJob.status}
                    </span>
                  </div>
                  {/* Page Range Display if set */}
                  {activeJob.selectedRange && (
                    <span className="text-xs text-blue-600 mt-0.5">
                       Processing pages {activeJob.selectedRange.start} - {activeJob.selectedRange.end}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                   {/* Page Selector for PDFs */}
                   {activeJob.pageCount && activeJob.pageCount > 0 && activeJob.status === 'idle' && (
                       <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                           <Layers size={14} className="text-gray-500" />
                           <input 
                             type="number" 
                             min="1" 
                             max={activeJob.pageCount}
                             placeholder="1"
                             className="w-12 h-7 text-sm border-gray-300 rounded px-1 text-center"
                             value={rangeStart}
                             onChange={(e) => setRangeStart(e.target.value)}
                           />
                           <span className="text-gray-400 text-xs">-</span>
                           <input 
                             type="number" 
                             min="1" 
                             max={activeJob.pageCount}
                             placeholder={activeJob.pageCount.toString()}
                             className="w-12 h-7 text-sm border-gray-300 rounded px-1 text-center"
                             value={rangeEnd}
                             onChange={(e) => setRangeEnd(e.target.value)}
                           />
                           <span className="text-xs text-gray-500">of {activeJob.pageCount}</span>
                       </div>
                   )}

                   {activeJob.status === 'idle' && (
                      <Button size="sm" onClick={() => handleStartOne(activeJob.id)}>
                        <Play className="h-4 w-4 mr-2" /> Start
                      </Button>
                   )}
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleDownload}
                    disabled={activeJob.status === 'queued' || activeJob.status === 'idle' || activeJob.status === 'processing'}
                    isLoading={isDownloading}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {t('download', locale)}
                  </Button>
                </div>
              </div>

              {/* Split Preview */}
              <div className="flex-1 overflow-hidden p-4 bg-gray-50">
                <SplitView 
                  segments={activeJob.segments}
                  htmlContent={activeJob.htmlContent}
                  isLoading={activeJob.status === 'queued'}
                  selectedRange={activeJob.selectedRange}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
              <div className="bg-gray-50 p-6 rounded-full mb-4">
                <Settings className="h-12 w-12 text-gray-300" />
              </div>
              <p className="text-lg font-medium text-gray-500">No file selected</p>
              <p className="text-sm mt-2">Upload a document to start translation</p>
            </div>
          )}
        </section>

      </main>
    </div>
  );
};

export default App;
