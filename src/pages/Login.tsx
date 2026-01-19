import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { logoGoogle, personOutline, lockClosedOutline, cloudUploadOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/auth.service';
import './Login.css';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const { login, register, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  if (user) {
    navigate('/dashboard');
    return null;
  }

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
              <IonIcon icon={cloudUploadOutline} className="login-logo-icon" />
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
                  />
                  <IonInput
                    type="email"
                    value={email}
                    placeholder="Email Address"
                    onIonInput={(e) => setEmail(e.detail.value!)}
                    onIonFocus={() => setFocusedInput('email')}
                    onIonBlur={() => setFocusedInput(null)}
                    required
                    disabled={loading}
                    className="login-input-field"
                  />
                </IonItem>
              </div>

              <div className={`custom-input ${focusedInput === 'password' ? 'has-focus' : ''}`}>
                <IonItem lines="none" className="ion-no-padding">
                  <IonIcon
                    icon={lockClosedOutline}
                    slot="start"
                    className={`input-icon ${focusedInput === 'password' ? 'active' : ''}`}
                  />
                  <IonInput
                    type="password"
                    value={password}
                    placeholder="Password"
                    onIonInput={(e) => setPassword(e.detail.value!)}
                    onIonFocus={() => setFocusedInput('password')}
                    onIonBlur={() => setFocusedInput(null)}
                    required
                    disabled={loading}
                    className="login-input-field"
                  />
                </IonItem>
              </div>

              <IonButton
                className="premium-button submit-button"
                expand="block"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <IonSpinner name="crescent" />
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
              disabled={loading}
            >
              <IonIcon slot="start" icon={logoGoogle} className="google-icon" />
              Sign in with Google
            </IonButton>

            <div className="switch-auth-container">
              <IonButton
                fill="clear"
                onClick={() => setIsRegister(!isRegister)}
                disabled={loading}
                className="switch-auth-button"
              >
                {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </IonButton>
            </div>

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
