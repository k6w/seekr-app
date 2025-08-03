import React, { useState, useRef, useEffect } from 'react';
import { Image as ImageIcon, FileX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  placeholder?: React.ReactNode;
}

export function LazyImage({ 
  src, 
  alt, 
  className, 
  fallback,
  placeholder 
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver>();

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // Set up intersection observer for lazy loading
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(img);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const handleLoad = () => {
    setIsLoaded(true);
    setHasError(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoaded(false);
  };

  const defaultPlaceholder = (
    <div className={cn(
      "flex items-center justify-center bg-muted rounded",
      "w-full h-full min-h-[60px]",
      className
    )}>
      <ImageIcon className="h-6 w-6 text-muted-foreground" />
    </div>
  );

  const defaultFallback = (
    <div className={cn(
      "flex items-center justify-center bg-muted rounded",
      "w-full h-full min-h-[60px]",
      className
    )}>
      <FileX className="h-6 w-6 text-muted-foreground" />
    </div>
  );

  if (hasError) {
    return fallback || defaultFallback;
  }

  if (!isInView) {
    return placeholder || defaultPlaceholder;
  }

  return (
    <div className={cn("relative overflow-hidden rounded", className)}>
      {!isLoaded && (placeholder || defaultPlaceholder)}
      
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-200",
          isLoaded ? "opacity-100" : "opacity-0 absolute inset-0"
        )}
        loading="lazy"
      />
    </div>
  );
}
