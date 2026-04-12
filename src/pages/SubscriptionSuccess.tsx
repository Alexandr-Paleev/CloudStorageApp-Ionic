import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonPage, IonText, IonIcon } from '@ionic/react';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { useQueryClient } from '@tanstack/react-query';

const SubscriptionSuccess: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['profile'] });

    const timer = setTimeout(() => {
      navigate('/dashboard', { replace: true });
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate, queryClient]);

  return (
    <IonPage>
      <IonContent
        fullscreen
        className="ion-padding"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <div style={{ textAlign: 'center', paddingTop: '30vh' }}>
          <IonIcon icon={checkmarkCircleOutline} color="success" style={{ fontSize: '80px' }} />
          <IonText>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '16px 0 8px' }}>
              Welcome to Pro!
            </h1>
            <p style={{ color: 'var(--ion-color-medium)' }}>
              Your subscription is active. Redirecting to dashboard...
            </p>
          </IonText>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SubscriptionSuccess;
