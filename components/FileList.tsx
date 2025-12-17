import React from 'react';
import { FileJob } from '../types';
import { FileText, CheckCircle, Clock, AlertCircle, PlayCircle, Play, Trash2 } from 'lucide-react';
import { ProgressBar } from './ProgressBar';

interface FileListProps {
  files: FileJob[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onStartAll: () => void;
  onStartOne: (id: string) => void;
  onDeleteOne: (id: string) => void;
  onDeleteAll: () => void;
}

export const FileList: React.FC<FileListProps> = ({ 
  files, 
  selectedFileId, 
  onSelectFile,
  onStartAll,
  onStartOne,
  onDeleteOne,
  onDeleteAll
}) => {
  const hasIdleFiles = files.some(f => f.status === 'idle');

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Batch Files</h3>
        
        <div className="flex items-center gap-2">
           {hasIdleFiles && (
            <button 
              onClick={(e) => { e.stopPropagation(); onStartAll(); }}
              className="text-blue-600 hover:bg-blue-100 hover:text-blue-700 p-1.5 rounded-md transition-colors"
              title="Start All Pending"
            >
              <Play size={18} fill="currentColor" />
            </button>
           )}
           {files.length > 0 && (
             <button
               onClick={(e) => { e.stopPropagation(); onDeleteAll(); }}
               className="text-gray-400 hover:bg-red-50 hover:text-red-500 p-1.5 rounded-md transition-colors"
               title="Clear All Files"
             >
               <Trash2 size={18} />
             </button>
           )}
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-2">
        {files.length === 0 && (
           <div className="text-center py-8 text-gray-400 text-sm">
             No files uploaded
           </div>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            onClick={() => onSelectFile(file.id)}
            className={`p-3 rounded-md cursor-pointer border transition-all relative group ${
              selectedFileId === file.id
                ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-300'
                : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-gray-50'
            }`}
          >
            {/* Delete button positioned absolute top-right */}
            <button
               onClick={(e) => { e.stopPropagation(); onDeleteOne(file.id); }}
               className="absolute top-2 right-2 text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 rounded-full transition-colors opacity-0 group-hover:opacity-100"
               title="Remove file"
            >
               <Trash2 size={14} />
            </button>

            <div className="flex items-start justify-between mb-2 pr-6">
              <div className="flex items-center space-x-2 overflow-hidden">
                <FileText className={`h-5 w-5 flex-shrink-0 ${
                  selectedFileId === file.id ? 'text-blue-600' : 'text-gray-400'
                }`} />
                <span className="text-sm font-medium text-gray-700 truncate block">
                  {file.name}
                </span>
              </div>
              <div className="flex-shrink-0 ml-2">
                {file.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-500" />}
                {file.status === 'processing' && <Clock className="h-4 w-4 text-blue-500 animate-pulse" />}
                {file.status === 'queued' && <Clock className="h-4 w-4 text-gray-400" />}
                {file.status === 'idle' && <PlayCircle className="h-4 w-4 text-yellow-500" />}
                {file.status === 'error' && <AlertCircle className="h-4 w-4 text-red-500" />}
              </div>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {file.status === 'processing' ? 'Translating...' : 
                   file.status === 'idle' ? 'Ready to Start' : 
                   file.status.charAt(0).toUpperCase() + file.status.slice(1)}
                </span>
                <span>{file.progress}%</span>
              </div>
              <ProgressBar progress={file.progress} className="h-1.5" />
            </div>
            
            <div className="mt-2 flex items-center justify-between">
               <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-600 border border-gray-200 uppercase">
                 {file.sourceLang} → {file.targetLang}
               </span>
               
               {/* Requirement 4 & 5: Individual start button (Icon only) at bottom right */}
               {file.status === 'idle' && (
                 <button 
                   onClick={(e) => { e.stopPropagation(); onStartOne(file.id); }}
                   className="text-blue-600 hover:bg-blue-100 p-1 rounded transition-colors"
                   title="Start this file"
                 >
                   <Play size={16} fill="currentColor" />
                 </button>
               )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
