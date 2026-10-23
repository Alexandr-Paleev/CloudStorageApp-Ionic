import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  IonContent,
  IonPage,
  IonButton,
  IonItem,
  IonInput,
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
import { LEGAL_URL } from '../utils/legal.utils';
import { askAgain, collectorsConfigured } from '../analytics/consent';
import './Legal.css';

/* Supabase's words for a password sign-in before the address is confirmed
   are "Email not confirmed". What to do about it is more use. */
function sayWhy(err: unknown): string {
  if ((err as { code?: unknown } | null)?.code === 'email_not_confirmed') {
    return 'This address is not confirmed yet. Open the link we emailed to it, then sign in.';
  }
  return err instanceof Error ? err.message : 'An error occurred';
}

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
  /* The address a confirmation link went to, after a sign-up that has to be
     confirmed before it can sign in; empty otherwise. */
  const [confirming, setConfirming] = useState('');
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
    } finally {
      setDemoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setConfirming('');
    setLoading(true);

    try {
      if (isRegister) {
        const { signedIn } = await register(email, password);
        if (!signedIn) {
          /* Signed out until the link is opened. This used to leave for the
             dashboard, which sent the visitor straight back to an empty form
             with nothing said: the toast went with the page it was on. What
             comes next is signing in, and it is done here. */
          setConfirming(email);
          setIsRegister(false);
          setPassword('');
          return;
        }
      } else {
        await login(email, password);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(sayWhy(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen className="login-content">
        <div className="login-container">
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
            {/* It names the address, so that a mistyped one shows, and is kept
                out of what Hotjar records, as the field is. A live region from
                the start, so that a screen reader says it when it appears. */}
            <div role="status" data-hj-suppress="">
              {confirming && (
                <p className="login-notice">
                  We have sent a link to <strong>{confirming}</strong>. Open it to confirm the
                  address, then sign in here. Already have an account? Just sign in.
                </p>
              )}
            </div>
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
                    /* Kept out of what Hotjar records, as the password is. It
                       was marked data-hj-allow, which lets Hotjar keep what is
                       typed here as soon as its keystroke capture is on. */
                    data-hj-suppress
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
                an account — Stripe checks for these before going live. They
                are pages of the site, so they open beside the app rather
                than in place of it. */}
            <p className="legal-links">
              By continuing you agree to our{' '}
              <a href={LEGAL_URL.terms} target="_blank" rel="noreferrer">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href={LEGAL_URL.privacy} target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              .
              {/* Where an answer about analytics cookies is changed before
                  anyone has signed in; the Account page is the other place. */}
              {collectorsConfigured() && (
                <>
                  {' '}
                  <button type="button" className="legal-links-button" onClick={askAgain}>
                    Cookie settings
                  </button>
                </>
              )}
            </p>

            {/* In the server's own words, which can quote the address typed
                above: Supabase answers 'Email address "…" cannot be used as
                it is not authorized', and '… is invalid'. Kept out of what
                Hotjar records, as the field is, and said only here: a
                toast's message is written onto its element as an attribute
                as well, which no mark hides (analytics/hotjar.ts). */}
            {error && (
              <div
                data-hj-suppress=""
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
      </IonContent>
    </IonPage>
  );
};

export default Login;
