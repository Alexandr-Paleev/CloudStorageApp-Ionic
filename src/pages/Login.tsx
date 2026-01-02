import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonText,
  IonToast,
  IonSpinner,
} from '@ionic/react';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);

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
      <IonHeader>
        <IonToolbar>
          <IonTitle>Cloud Storage</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="ion-padding">
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100%',
          }}
        >
          <IonCard style={{ width: '100%', maxWidth: '400px' }}>
            <IonCardHeader>
              <IonCardTitle>{isRegister ? 'Create Account' : 'Sign In'}</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <form onSubmit={handleSubmit}>
                <IonItem>
                  <IonLabel position="stacked">Email</IonLabel>
                  <IonInput
                    type="email"
                    value={email}
                    onIonInput={(e) => setEmail(e.detail.value!)}
                    required
                    disabled={loading}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Password</IonLabel>
                  <IonInput
                    type="password"
                    value={password}
                    onIonInput={(e) => setPassword(e.detail.value!)}
                    required
                    disabled={loading}
                  />
                </IonItem>
                <IonButton
                  expand="block"
                  type="submit"
                  disabled={loading}
                  style={{ marginTop: '20px' }}
                >
                  {loading ? <IonSpinner name="crescent" /> : isRegister ? 'Register' : 'Sign In'}
                </IonButton>
              </form>

              <IonButton
                expand="block"
                fill="clear"
                onClick={() => setIsRegister(!isRegister)}
                disabled={loading}
                style={{ marginTop: '10px' }}
              >
                {isRegister
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Register"}
              </IonButton>

              {error && (
                <IonText
                  color="danger"
                  style={{ display: 'block', marginTop: '10px', textAlign: 'center' }}
                >
                  {error}
                </IonText>
              )}
            </IonCardContent>
          </IonCard>
        </div>

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={
            error || (isRegister ? 'Account created! Please sign in.' : 'Signed in successfully!')
          }
          duration={3000}
          color={error ? 'danger' : 'success'}
        />
      </IonContent>
    </IonPage>
  );
};

export default Login;
