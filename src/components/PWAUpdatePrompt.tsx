import { IonToast } from '@ionic/react';
import { usePWAUpdate } from '../hooks/usePWAUpdate';

/**
 * PWA Update Toast Component
 * Displays update notification when new version is available
 */
export const PWAUpdatePrompt: React.FC = () => {
  const { needRefresh, updateServiceWorker, close } = usePWAUpdate();

  if (!needRefresh) return null;

  return (
    <IonToast
      isOpen={needRefresh}
      message="New version available!"
      position="bottom"
      buttons={[
        {
          text: 'Update',
          role: 'confirm',
          handler: () => {
            updateServiceWorker(true);
          },
        },
        {
          text: 'Later',
          role: 'cancel',
          handler: () => {
            close();
          },
        },
      ]}
      duration={0}
    />
  );
};
