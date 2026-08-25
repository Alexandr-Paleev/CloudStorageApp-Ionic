import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonText,
} from '@ionic/react';
import { useNavigate } from 'react-router-dom';

const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Page Not Found</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding ion-text-center">
        <div style={{ paddingTop: '20vh' }}>
          <IonText color="dark">
            <h1 style={{ fontSize: '72px', fontWeight: 700, margin: 0 }}>404</h1>
            <p style={{ color: '#64748b', margin: '16px 0' }}>
              The page you&apos;re looking for doesn&apos;t exist.
            </p>
          </IonText>
          <IonButton onClick={() => navigate('/dashboard', { replace: true })}>
            Go to Dashboard
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default NotFound;
