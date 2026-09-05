import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonButton,
  IonItem,
  IonInput,
  IonToast,
  IonSpinner,
  IonIcon,
} from '@ionic/react';
import {
  logoGoogle,
  personOutline,
  lockClosedOutline,
  cloudUploadOutline,
  flashOutline,
} from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/auth.service';
import demoService from '../services/demo.service';
import { env } from '../env';
import { setStatusBarForDarkBackground, syncStatusBarStyle } from '../native/shell';
import './Login.css';
import './Legal.css';

const Login: React.FC = () => {
  /* This page is a deep indigo gradient in both themes, and on a device the
     status bar sits on top of it. Without this the clock follows body.dark and
     turns dark-on-dark in the light theme — invisible. Restored on the way out,
     because every other screen is light. No-op in a browser. */
  useEffect(() => {
    void setStatusBarForDarkBackground(true);
    return () => {
      void syncStatusBarStyle();
    };
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const { login, register, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in. Declared rather than called: navigate() here
  // is a side effect during render, which React makes no promise about — under
  // StrictMode the render runs twice, and a concurrent render that is thrown
  // away would still have pushed onto the history stack. Pricing.tsx does the
  // same thing this way. `replace` keeps /login out of the back history.
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  /* Either request in flight locks the whole card: two sessions being opened
     at once would race to write the same auth store. */
  const busy = loading || demoLoading;

  const handleDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      await demoService.start();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a demo session');
      setShowToast(true);
    } finally {
      setDemoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, password);
        setShowToast(true);
      } else {
        await login(email, password);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="bg-gradient-primary login-container">
          {/* Logo / Brand */}
          <div className="brand-container">
            <div className="brand-logo-circle">
              <IonIcon icon={cloudUploadOutline} className="login-logo-icon" aria-hidden="true" />
            </div>
            <h1 className="brand-title">Cloud Storage</h1>
            <p className="brand-subtitle">
              {isRegister ? 'Create your secure space' : 'Welcome back'}
            </p>
          </div>

          {/* Glass Card */}
          <div className="glass-card auth-form-card">
            <form onSubmit={handleSubmit}>
              <div className={`custom-input ${focusedInput === 'email' ? 'has-focus' : ''}`}>
                <IonItem lines="none" className="ion-no-padding">
                  <IonIcon
                    icon={personOutline}
                    slot="start"
                    className={`input-icon ${focusedInput === 'email' ? 'active' : ''}`}
                    aria-hidden="true"
                  />
                  <IonInput
                    type="email"
                    value={email}
                    placeholder="Email Address"
                    onIonInput={(e) => setEmail(e.detail.value!)}
                    onIonFocus={() => setFocusedInput('email')}
                    onIonBlur={() => setFocusedInput(null)}
                    required
                    disabled={busy}
                    className="login-input-field"
                    data-hj-allow
                  />
                </IonItem>
              </div>

              <div className={`custom-input ${focusedInput === 'password' ? 'has-focus' : ''}`}>
                <IonItem lines="none" className="ion-no-padding">
                  <IonIcon
                    icon={lockClosedOutline}
                    slot="start"
                    className={`input-icon ${focusedInput === 'password' ? 'active' : ''}`}
                    aria-hidden="true"
                  />
                  <IonInput
                    type="password"
                    value={password}
                    placeholder="Password"
                    onIonInput={(e) => setPassword(e.detail.value!)}
                    onIonFocus={() => setFocusedInput('password')}
                    onIonBlur={() => setFocusedInput(null)}
                    required
                    disabled={busy}
                    className="login-input-field"
                    data-hj-suppress
                  />
                </IonItem>
              </div>

              <IonButton
                className="premium-button submit-button"
                expand="block"
                type="submit"
                disabled={busy}
              >
                {loading ? (
                  <IonSpinner name="crescent" aria-label="Working" />
                ) : isRegister ? (
                  'Create Account'
                ) : (
                  'Sign In'
                )}
              </IonButton>
            </form>

            {/* Divider */}
            <div className="divider-container">
              <div className="divider-line"></div>
              <span className="divider-text">or continue with</span>
              <div className="divider-line"></div>
            </div>

            <IonButton
              expand="block"
              className="google-sign-in-button"
              onClick={async () => {
                setLoading(true);
                try {
                  await authService.signInWithGoogle();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Google login failed');
                  setShowToast(true);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={busy}
            >
              <IonIcon slot="start" icon={logoGoogle} className="google-icon" aria-hidden="true" />
              Sign in with Google
            </IonButton>

            <div className="switch-auth-container">
              <IonButton
                fill="clear"
                onClick={() => setIsRegister(!isRegister)}
                disabled={busy}
                className="switch-auth-button"
              >
                {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </IonButton>
            </div>

            {/* Last, and quiet on purpose.
                This was the first element on the card and styled like the
                submit button, which made the page read as a showcase rather
                than as a product — two identical primary buttons, and the real
                one below the fold. A visitor who wants in without signing up
                still finds it in one glance; a visitor who came to log in is no
                longer asked to step around it. */}
            {env.VITE_DEMO_ENABLED && (
              <div className="demo-entry">
                <IonButton
                  fill="clear"
                  className="demo-button"
                  onClick={handleDemo}
                  disabled={busy}
                  data-testid="demo-login"
                >
                  {demoLoading ? (
                    <IonSpinner name="crescent" aria-label="Working" />
                  ) : (
                    <>
                      <IonIcon slot="start" icon={flashOutline} aria-hidden="true" />
                      Just looking? Open a demo account
                    </>
                  )}
                </IonButton>
                <p className="demo-caption">No sign-up. Deleted after 24 hours.</p>
              </div>
            )}

            {/* Shown at the point of account creation, and reachable without
                an account — Stripe checks for these before going live. */}
            <p className="legal-links">
              By continuing you agree to our <Link to="/terms">Terms of Service</Link> and{' '}
              <Link to="/privacy">Privacy Policy</Link>.
            </p>

            {error && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  borderRadius: '8px',
                  textAlign: 'center',
                  fontSize: '14px',
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={
            error || (isRegister ? 'Account created! Please sign in.' : 'Signed in successfully!')
          }
          duration={3000}
          color={error ? 'danger' : 'success'}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Login;
