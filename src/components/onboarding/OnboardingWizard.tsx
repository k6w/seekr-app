import React, { useState, useEffect } from 'react';
import { 
  Search, 
  HardDrive, 
  Zap, 
  CheckCircle, 
  ArrowRight, 
  ArrowLeft,
  Sparkles,
  FolderOpen,
  Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface OnboardingWizardProps {
  isVisible: boolean;
  onComplete: () => void;
  onStartIndexing: () => void;
}

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to File Search',
    description: 'Lightning-fast file searching for your entire system',
    icon: Sparkles,
    content: (
      <div className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
          <Search className="h-8 w-8 text-primary" />
        </div>
        <p className="text-muted-foreground">
          Find any file on your computer instantly with powerful search operators, 
          real-time indexing, and beautiful modern interface.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Badge variant="secondary">Instant Search</Badge>
          <Badge variant="secondary">Real-time Updates</Badge>
          <Badge variant="secondary">Advanced Filters</Badge>
        </div>
      </div>
    )
  },
  {
    id: 'indexing',
    title: 'Index Your Files',
    description: 'We need to scan your files once to enable lightning-fast search',
    icon: HardDrive,
    content: (
      <div className="space-y-4">
        <div className="mx-auto w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center">
          <HardDrive className="h-8 w-8 text-blue-500" />
        </div>
        <div className="space-y-3">
          <p className="text-muted-foreground text-center">
            File Search will scan your drives to create a searchable index. 
            This happens once and then updates automatically.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">Safe and secure - no data leaves your computer</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">Real-time updates when files change</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">Excludes system and temporary files</span>
            </div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'features',
    title: 'Powerful Features',
    description: 'Learn about the advanced search capabilities',
    icon: Zap,
    content: (
      <div className="space-y-4">
        <div className="mx-auto w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center">
          <Zap className="h-8 w-8 text-yellow-500" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <h4 className="font-medium text-sm mb-1">Search Operators</h4>
            <p className="text-xs text-muted-foreground mb-2">Use powerful operators to refine your search</p>
            <div className="flex flex-wrap gap-1">
              <code className="bg-background px-1.5 py-0.5 rounded text-xs">ext:pdf</code>
              <code className="bg-background px-1.5 py-0.5 rounded text-xs">type:image</code>
              <code className="bg-background px-1.5 py-0.5 rounded text-xs">size:10MB+</code>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <h4 className="font-medium text-sm mb-1">Keyboard Shortcuts</h4>
            <p className="text-xs text-muted-foreground mb-2">Work faster with hotkeys</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Focus search</span>
                <kbd className="bg-background px-1 rounded">Ctrl+K</kbd>
              </div>
              <div className="flex justify-between">
                <span>Show/Hide app</span>
                <kbd className="bg-background px-1 rounded">Ctrl+Shift+F</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'ready',
    title: 'Ready to Search!',
    description: 'Everything is set up and ready to go',
    icon: CheckCircle,
    content: (
      <div className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
          <CheckCircle className="h-8 w-8 text-green-500" />
        </div>
        <p className="text-muted-foreground">
          File Search is now ready! The app will minimize to your system tray 
          and continue indexing in the background. Use the global shortcut 
          <kbd className="bg-muted px-1 mx-1 rounded">Ctrl+Shift+F</kbd> 
          to quickly access it anytime.
        </p>
        <div className="bg-blue-500/10 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            💡 Tip: The app runs in the background and updates your file index automatically. 
            You can always access it from the system tray.
          </p>
        </div>
      </div>
    )
  }
];

export function OnboardingWizard({ isVisible, onComplete, onStartIndexing }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isIndexingStarted, setIsIndexingStarted] = useState(false);

  const currentStepData = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isIndexingStep = currentStepData.id === 'indexing';

  const handleNext = () => {
    if (isIndexingStep && !isIndexingStarted) {
      onStartIndexing();
      setIsIndexingStarted(true);
    }
    
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg mx-auto animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader className="text-center pb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <currentStepData.icon className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{currentStepData.title}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">{currentStepData.description}</p>
          
          {/* Progress indicator */}
          <div className="flex justify-center gap-2 mt-4">
            {ONBOARDING_STEPS.map((_, index) => (
              <div
                key={index}
                className={cn(
                  "w-2 h-2 rounded-full transition-colors",
                  index === currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {currentStepData.content}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-2">
              {currentStep > 0 && (
                <Button variant="outline" onClick={handlePrevious} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>
              )}
              
              {!isLastStep && (
                <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground">
                  Skip
                </Button>
              )}
            </div>

            <Button onClick={handleNext} className="gap-2">
              {isLastStep ? (
                <>
                  Get Started
                  <CheckCircle className="h-4 w-4" />
                </>
              ) : isIndexingStep ? (
                <>
                  Start Indexing
                  <HardDrive className="h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
