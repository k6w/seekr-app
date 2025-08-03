import { useState, useEffect, useCallback } from 'react';

interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultCount?: number;
}

const STORAGE_KEY = 'file-search-history';
const MAX_HISTORY_ITEMS = 50;

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(Array.isArray(parsed) ? parsed : []);
      }
    } catch (error) {
      console.warn('Failed to load search history:', error);
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('Failed to save search history:', error);
    }
  }, [history]);

  const addToHistory = useCallback((query: string, resultCount?: number) => {
    if (!query.trim()) return;

    setHistory(prev => {
      // Remove existing entry with same query
      const filtered = prev.filter(item => item.query !== query);
      
      // Add new entry at the beginning
      const newHistory = [
        { query, timestamp: Date.now(), resultCount },
        ...filtered
      ];

      // Limit to MAX_HISTORY_ITEMS
      return newHistory.slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const removeFromHistory = useCallback((query: string) => {
    setHistory(prev => prev.filter(item => item.query !== query));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const getRecentSearches = useCallback((limit: number = 10) => {
    return history.slice(0, limit);
  }, [history]);

  const getPopularSearches = useCallback((limit: number = 10) => {
    // Group by query and count occurrences
    const queryCount = history.reduce((acc, item) => {
      acc[item.query] = (acc[item.query] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Sort by count and return top queries
    return Object.entries(queryCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([query, count]) => ({
        query,
        count,
        lastUsed: history.find(item => item.query === query)?.timestamp || 0
      }));
  }, [history]);

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getRecentSearches,
    getPopularSearches
  };
}
