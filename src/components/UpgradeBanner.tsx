import { IonButton, IonIcon, IonText } from '@ionic/react';
import { rocketOutline } from 'ionicons/icons';
import { useNavigate } from 'react-router';
import { formatStorage } from '@cloud-storage/core/format';
import { TIER_LIMITS } from '@cloud-storage/core/tiers';
import { billingIsOffered } from '../utils/billing.utils';
import { storageMeter } from '../utils/quota.utils';

/* What Pro gives, read from the limit that enforces it. The line used to be
   typed out, and promised Dropbox as well, which this deployment does not
   offer yet. */
const PRO_STORAGE = formatStorage(TIER_LIMITS.pro.storage_limit);

interface UpgradeBannerProps {
  usedBytes: number;
  storageLimit: number;
  tier?: string;
}

const UpgradeBanner: React.FC<UpgradeBannerProps> = ({ usedBytes, storageLimit, tier }) => {
  const navigate = useNavigate();
  // Same arithmetic as the dashboard meter, so the banner cannot appear at a
  // percentage the bar disagrees with.
  const { ratio: usagePercent } = storageMeter(usedBytes, storageLimit);

  if (!billingIsOffered() || tier === 'pro' || usagePercent < 0.8) return null;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1 }}>
        <IonText>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: '#fff' }}>
            {usagePercent >= 1 ? 'Storage full!' : 'Running low on storage'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', opacity: 0.9, color: '#fff' }}>
            Upgrade to Pro for {PRO_STORAGE} of storage
          </p>
        </IonText>
      </div>
      <IonButton
        fill="solid"
        color="light"
        size="small"
        onClick={() => navigate('/pricing')}
        style={{ '--color': '#4f46e5' }}
      >
        <IonIcon icon={rocketOutline} slot="start" aria-hidden="true" />
        Upgrade
      </IonButton>
    </div>
  );
};

export default UpgradeBanner;
