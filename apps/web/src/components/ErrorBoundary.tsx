import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n/init';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level ErrorBoundary (ADR-011 §9). Captures unhandled render errors and
 * shows a Turkish "something went wrong" screen with reload action.
 * UI strings flow through i18n directly (the toast/router context may be broken).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Production wiring (Sentry/pino) lives in apps/api; web logs to console for now.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-2xl font-semibold">{i18n.t('common.errorTitle')}</h1>
          <p className="max-w-md text-sm text-muted-foreground">{i18n.t('common.errorBody')}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="h-12 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {i18n.t('common.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
