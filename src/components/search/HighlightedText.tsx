import React from 'react';
import { cn } from '@/lib/utils';

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
  highlightClassName?: string;
}

export function HighlightedText({ 
  text, 
  query, 
  className,
  highlightClassName = "bg-yellow-200 dark:bg-yellow-800 font-medium"
}: HighlightedTextProps) {
  if (!query.trim()) {
    return <span className={className}>{text}</span>;
  }

  // Clean the query by removing search operators
  const cleanQuery = query
    .replace(/ext:\w+/gi, '')
    .replace(/size:[><]?\d+(kb|mb|gb)?/gi, '')
    .replace(/date:(today|yesterday|week|month|year)/gi, '')
    .replace(/type:\w+/gi, '')
    .trim();

  if (!cleanQuery) {
    return <span className={className}>{text}</span>;
  }

  // Split query into words for better matching
  const queryWords = cleanQuery
    .split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex chars

  if (queryWords.length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Create regex pattern that matches any of the query words
  const pattern = new RegExp(`(${queryWords.join('|')})`, 'gi');
  const parts = text.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const isMatch = queryWords.some(word => 
          new RegExp(word, 'i').test(part)
        );
        
        return isMatch ? (
          <mark key={index} className={cn("rounded px-0.5", highlightClassName)}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </span>
  );
}
