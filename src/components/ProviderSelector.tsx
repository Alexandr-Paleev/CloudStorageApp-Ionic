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

/* `satisfies` rather than a `Record<string, …>` annotation: the annotation
   widened the key to `string`, which made every lookup below a lookup that
   might miss — and made the list of five names have to be written out twice,
   once here and once as the render order. Keys stay literal, so indexing is
   checked at compile time and the order comes from this object. */
const PROVIDER_INFO = {
  cloudinary: { label: 'Cloudinary', icon: imagesOutline },
  r2: { label: 'Cloudflare R2', icon: serverOutline },
  supabase_storage: { label: 'Supabase', icon: cloudOutline },
  googledrive: { label: 'Google Drive', icon: logoGoogle },
  dropbox: { label: 'Dropbox', icon: logoDropbox },
} satisfies Record<string, { label: string; icon: string }>;

const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  allowedProviders,
  onSelect,
}) => {
  const allProviders = Object.keys(PROVIDER_INFO) as Array<keyof typeof PROVIDER_INFO>;

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
              <IonIcon icon={isAllowed ? info.icon : lockClosedOutline} aria-hidden="true" />
              <IonLabel>{info.label}</IonLabel>
            </IonChip>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderSelector;
