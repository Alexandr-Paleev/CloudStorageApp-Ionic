import { Component, ReactNode } from 'react';
import { IonPage, IonContent, IonButton, IonText } from '@ionic/react';
import * as Sentry from '../observability/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  handleReload = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <IonPage>
          <IonContent className="ion-padding ion-text-center">
            <div style={{ paddingTop: '25vh' }}>
              <IonText color="dark">
                <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Something went wrong</h1>
                <p style={{ color: '#64748b', margin: '16px 0' }}>
                  An unexpected error occurred. Please try again.
                </p>
              </IonText>
              <IonButton onClick={this.handleReload}>Reload App</IonButton>
            </div>
          </IonContent>
        </IonPage>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
