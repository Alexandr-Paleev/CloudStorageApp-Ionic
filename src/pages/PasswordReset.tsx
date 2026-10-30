import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonPage,
  IonSpinner,
} from '@ionic/react';
import { cloudUploadOutline, lockClosedOutline, personOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import { passwordResetService } from '../services/password-reset.service';
import { setStatusBarForDarkBackground, syncStatusBarStyle } from '../native/shell';
import './Login.css';

/**
 * A forgotten password, in two steps on the login page's card: asking for a
 * link (`/forgot-password`) and choosing the new password the link leads to
 * (`/new-password`).
 *
 * The second step needs no event from Supabase. The link brings a session in
 * its fragment, and the client has read it by the time it stops loading; a
 * `PASSWORD_RECOVERY` subscriber that arrives later than that hears nothing.
 * What the page asks is whether there is a session, so a signed-in person
 * who comes here on purpose can choose a new password too.
 */

type Step = 'ask' | 'choose';

interface FieldProps {
  icon: string;
  type: 'email' | 'password';
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autocomplete: 'email' | 'new-password';
}

/** One of the login page's inputs. Kept out of what Hotjar records, as there. */
function Field({ icon, type, placeholder, value, onChange, disabled, autocomplete }: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={`custom-input ${focused ? 'has-focus' : ''}`}>
      <IonItem lines="none" className="ion-no-padding">
        <IonIcon
          icon={icon}
          slot="start"
          className={`input-icon ${focused ? 'active' : ''}`}
          aria-hidden="true"
        />
        <IonInput
          type={type}
          value={value}
          placeholder={placeholder}
          autocomplete={autocomplete}
          onIonInput={(e) => onChange(e.detail.value ?? '')}
          onIonFocus={() => setFocused(true)}
          onIonBlur={() => setFocused(false)}
          required
          disabled={disabled}
          className="login-input-field"
          data-hj-suppress
        />
      </IonItem>
    </div>
  );
}

/* In the server's own words, which can quote the address typed above, as on
   the login page. */
function Problem({ children }: { children: string }) {
  return (
    <div className="login-error" data-hj-suppress="">
      {children}
    </div>
  );
}

function AskForLink() {
  const location = useLocation();
  const navigate = useNavigate();
  /* Carried over from the login page, where it may have been typed already. */
  const [email, setEmail] = useState(
    () => (location.state as { email?: string } | null)?.email ?? ''
  );
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await passwordResetService.requestLink(email);
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* "If", because Supabase answers the same for an address with no
          account, and so must this. */}
      <div role="status" data-hj-suppress="">
        {sentTo && (
          <p className="login-notice">
            If <strong>{sentTo}</strong> has an account here, a link to choose a new password is on
            its way to it. It works once, in any browser.
          </p>
        )}
      </div>
      <form onSubmit={send}>
        <Field
          icon={personOutline}
          type="email"
          placeholder="Email Address"
          value={email}
          onChange={setEmail}
          disabled={sending}
          autocomplete="email"
        />
        <IonButton
          className="premium-button submit-button"
          expand="block"
          type="submit"
          disabled={sending}
        >
          {sending ? <IonSpinner name="crescent" aria-label="Working" /> : 'Send link'}
        </IonButton>
      </form>
      <div className="switch-auth-container">
        <IonButton
          fill="clear"
          className="switch-auth-button"
          onClick={() => navigate('/login')}
          disabled={sending}
        >
          Back to sign in
        </IonButton>
      </div>
      {error && <Problem>{error}</Problem>}
    </>
  );
}

function ChoosePassword() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (loading) {
    return (
      <div className="password-reset-waiting">
        <IonSpinner aria-label="Loading" />
      </div>
    );
  }

  /* A link that has run out, or was used already, comes back with an error in
     place of a session, and there is no account to choose a password for. */
  if (!user) {
    return (
      <>
        <p className="login-notice">
          This link has run out or has been used already. Each one works once, for a limited time:
          ask for another and open the newest.
        </p>
        <IonButton
          className="premium-button submit-button"
          expand="block"
          onClick={() => navigate('/forgot-password', { replace: true })}
        >
          Send a new link
        </IonButton>
        <div className="switch-auth-container">
          <IonButton fill="clear" className="switch-auth-button" onClick={() => navigate('/login')}>
            Back to sign in
          </IonButton>
        </div>
      </>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    /* Asked twice because nothing shows it: a slip here is a password nobody
       knows, and another trip through the mail. */
    if (password !== repeated) {
      setError('The two passwords are not the same.');
      return;
    }
    setSaving(true);
    try {
      await passwordResetService.setNewPassword(password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the password');
      setSaving(false);
    }
  };

  return (
    <>
      <p className="login-notice" data-hj-suppress="">
        For <strong>{user.email}</strong>.
      </p>
      <form onSubmit={save}>
        <Field
          icon={lockClosedOutline}
          type="password"
          placeholder="New password"
          value={password}
          onChange={setPassword}
          disabled={saving}
          autocomplete="new-password"
        />
        <Field
          icon={lockClosedOutline}
          type="password"
          placeholder="The new password again"
          value={repeated}
          onChange={setRepeated}
          disabled={saving}
          autocomplete="new-password"
        />
        <IonButton
          className="premium-button submit-button"
          expand="block"
          type="submit"
          disabled={saving}
        >
          {saving ? <IonSpinner name="crescent" aria-label="Working" /> : 'Save password'}
        </IonButton>
      </form>
      {error && <Problem>{error}</Problem>}
    </>
  );
}

const PasswordReset: React.FC<{ step: Step }> = ({ step }) => {
  /* The login page's gradient, and so its status bar. No-op in a browser. */
  useEffect(() => {
    void setStatusBarForDarkBackground(true);
    return () => {
      void syncStatusBarStyle();
    };
  }, []);

  return (
    <IonPage>
      <IonContent fullscreen className="login-content">
        <div className="login-container">
          <div className="brand-container">
            <div className="brand-logo-circle">
              <IonIcon icon={cloudUploadOutline} className="login-logo-icon" aria-hidden="true" />
            </div>
            <h1 className="brand-title">Cloud Storage</h1>
            <p className="brand-subtitle">
              {step === 'ask' ? 'Forgot your password?' : 'Choose a new password'}
            </p>
          </div>
          <div className="glass-card auth-form-card">
            {step === 'ask' ? <AskForLink /> : <ChoosePassword />}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default PasswordReset;
