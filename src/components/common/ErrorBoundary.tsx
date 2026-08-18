/**
 * Error Boundary Component
 * Catches and displays errors in the component tree
 */
import { Component, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorBoundaryFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  const { t } = useTranslation(['errors', 'common']);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <CardTitle>{t('errors:UNKNOWN.title')}</CardTitle>
          </div>
          <CardDescription>{t('errors:UNKNOWN.message')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <pre className="rounded-lg bg-surface-input p-4 text-sm overflow-auto max-h-40">
              {error.message}
            </pre>
          )}
          <Button onClick={onReset} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('errors:retry')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorBoundaryFallback error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}
