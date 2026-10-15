import { IonText } from '@ionic/react';
import { formatFileSize } from '../utils/format.utils';
import { storageMeter } from '../utils/quota.utils';

interface StorageMeterProps {
  usedBytes: number;
  /** What the plan allows. The caller decides which limit that is. */
  storageLimit: number;
  tier?: string;
}

/**
 * How much of the plan is in use: the one number on the dashboard a person is
 * asked to act on.
 *
 * The bar stops at full and the sentence does not. An account past its limit
 * is told by how much, and that uploads are blocked until there is room again;
 * storageMeter says why the two halves are measured differently.
 */
const StorageMeter: React.FC<StorageMeterProps> = ({ usedBytes, storageLimit, tier }) => {
  const { barWidth, percentage, isOverLimit } = storageMeter(usedBytes, storageLimit);

  return (
    <div className="glass-card storage-card">
      <div className="storage-header">
        <IonText color="dark" className="storage-title">
          Storage Used
        </IonText>
        <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-percentage">
          {percentage}%
        </IonText>
      </div>

      <div className="storage-bar-container">
        <div
          className="storage-bar-fill"
          style={{
            width: `${barWidth}%`,
          }}
        />
      </div>

      <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-stats">
        {formatFileSize(usedBytes)} of {formatFileSize(storageLimit)} used
        {isOverLimit &&
          ` — ${formatFileSize(usedBytes - storageLimit)} over the limit, uploads are blocked until you free up space`}
        {tier === 'pro' && <span className="tier-badge tier-badge--pro">Pro</span>}
      </IonText>
    </div>
  );
};

export default StorageMeter;
