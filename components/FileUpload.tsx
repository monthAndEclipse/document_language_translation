import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';
import { t } from '../utils/i18n';
import { SupportedLocale } from '../types';

interface FileUploadProps {
  onUpload: (files: FileList) => void;
  locale: SupportedLocale;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUpload, locale }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      // Reset the value so the same file can be selected again
      e.target.value = '';
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors h-32 group"
    >
      <input
        type="file"
        multiple
        ref={inputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      <UploadCloud className="h-8 w-8 text-gray-400 group-hover:text-blue-500 mb-2 transition-colors" />
      <p className="text-sm font-medium text-gray-700">{t('uploadTitle', locale)}</p>
      <p className="text-xs text-gray-500 mt-1">{t('supportedFormats', locale)}</p>
    </div>
  );
};
