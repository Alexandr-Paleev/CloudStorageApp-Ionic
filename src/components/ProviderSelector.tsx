import { IonChip, IonIcon, IonLabel } from '@ionic/react';
import {
  cloudOutline,
  lockClosedOutline,
  logoDropbox,
  logoGoogle,
  serverOutline,
  imagesOutline,
} from 'ionicons/icons';

interface ProviderSelectorProps {
  selectedProvider: string | undefined;
  allowedProviders: string[];
  onSelect: (provider: string | undefined) => void;
}

const PROVIDER_INFO: Record<string, { label: string; icon: string }> = {
  cloudinary: { label: 'Cloudinary', icon: imagesOutline },
  r2: { label: 'Cloudflare R2', icon: serverOutline },
  supabase_storage: { label: 'Supabase', icon: cloudOutline },
  googledrive: { label: 'Google Drive', icon: logoGoogle },
  dropbox: { label: 'Dropbox', icon: logoDropbox },
};

const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  allowedProviders,
  onSelect,
}) => {
  const allProviders = ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'];

  return (
    <div style={{ marginTop: '12px' }}>
      <p style={{ fontSize: '14px', color: 'var(--ion-color-medium)', marginBottom: '8px' }}>
        Upload to:
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <IonChip
          color={selectedProvider === undefined ? 'primary' : 'medium'}
          outline={selectedProvider !== undefined}
          onClick={() => onSelect(undefined)}
        >
          <IonLabel>Auto</IonLabel>
        </IonChip>

        {allProviders.map((provider) => {
          const info = PROVIDER_INFO[provider];
          const isAllowed = allowedProviders.includes(provider);

          return (
            <IonChip
              key={provider}
              color={selectedProvider === provider ? 'primary' : 'medium'}
              outline={selectedProvider !== provider}
              disabled={!isAllowed}
              onClick={() => isAllowed && onSelect(provider)}
            >
              <IonIcon icon={isAllowed ? info.icon : lockClosedOutline} />
              <IonLabel>{info.label}</IonLabel>
            </IonChip>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderSelector;
