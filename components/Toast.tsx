import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, duration = 4000 }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px]">
        <AlertCircle size={20} className="text-red-500 shrink-0" />
        <span className="text-sm font-medium flex-1">{message}</span>
        <button 
          onClick={onClose}
          className="text-red-400 hover:text-red-600 transition-colors p-1"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};