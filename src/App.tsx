import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { IonApp, IonSpinner, setupIonicReact } from '@ionic/react';

import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
import { PageViewTracker } from './components/PageViewTracker';
import { useHotjarStateChange } from './analytics/hotjar';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './theme/variables.css';
import './theme/global.css';

setupIonicReact();

// Lazy-loaded pages for code-splitting
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Upload = lazy(() => import('./pages/Upload'));
const FileView = lazy(() => import('./pages/FileView'));
const Pricing = lazy(() => import('./pages/Pricing'));
const SubscriptionSuccess = lazy(() => import('./pages/SubscriptionSuccess'));
const DropboxCallback = lazy(() => import('./pages/DropboxCallback'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Legal = lazy(() => import('./pages/Legal'));
const SharedFile = lazy(() => import('./pages/SharedFile'));

const PageLoader: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <IonSpinner color="primary" />
  </div>
);

// Component to handle Hotjar state changes
const HotjarTracker: React.FC = () => {
  useHotjarStateChange();
  return null;
};

const App: React.FC = () => (
  <IonApp>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <PageViewTracker />
          <HotjarTracker />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              {/* Public on purpose: Stripe reviews these before enabling live
                  payments, and app stores need a reachable privacy policy —
                  neither has an account to sign in with. */}
              <Route path="/terms" element={<Legal document="terms" />} />
              <Route path="/privacy" element={<Legal document="privacy" />} />
              {/* Also public, and necessarily so: the token in the URL is the
                  only credential a share link carries. */}
              <Route path="/s/:token" element={<SharedFile />} />
              <Route
                path="/dashboard/:folderId?"
                element={
                  <PrivateRoute>
                    <Dashboard />
                  </PrivateRoute>
                }
              />
              <Route
                path="/upload/:folderId?"
                element={
                  <PrivateRoute>
                    <Upload />
                  </PrivateRoute>
                }
              />
              <Route
                path="/file/:fileId"
                element={
                  <PrivateRoute>
                    <FileView />
                  </PrivateRoute>
                }
              />
              <Route
                path="/pricing"
                element={
                  <PrivateRoute>
                    <Pricing />
                  </PrivateRoute>
                }
              />
              <Route
                path="/subscription/success"
                element={
                  <PrivateRoute>
                    <SubscriptionSuccess />
                  </PrivateRoute>
                }
              />
              <Route
                path="/auth/dropbox/callback"
                element={
                  <PrivateRoute>
                    <DropboxCallback />
                  </PrivateRoute>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
    <PWAUpdatePrompt />
  </IonApp>
);

export default App;
