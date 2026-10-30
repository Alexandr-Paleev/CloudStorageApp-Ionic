import { useId } from 'react';
import { IonChip, IonIcon, IonLabel } from '@ionic/react';
import {
  cloudOutline,
  lockClosedOutline,
  logoDropbox,
  logoGoogle,
  serverOutline,
  imagesOutline,
} from 'ionicons/icons';
import './ProviderSelector.css';

interface ProviderSelectorProps {
  selectedProvider: string | undefined;
  /** What the plan includes. A provider outside it is shown, locked. */
  allowedProviders: string[];
  /** What this deployment has set up. A provider outside it is not shown at
   *  all: no plan would make it work, and choosing one failed every upload
   *  with a sentence meant for whoever deploys this. */
  configuredProviders: string[];
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

/**
 * Where a Pro account's next uploads go.
 *
 * Each choice is a button that says whether it is pressed, with the chip
 * drawn inside it. The chips used to be the controls themselves, and an
 * ion-chip is an element with no role and no tabindex: a keyboard could not
 * reach one and a screen reader did not say it could be pressed. axe passed
 * it, because it cannot see a click handler.
 */
const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  allowedProviders,
  configuredProviders,
  onSelect,
}) => {
  const label = useId();
  const offered = (Object.keys(PROVIDER_INFO) as Array<keyof typeof PROVIDER_INFO>).filter(
    (provider) => configuredProviders.includes(provider)
  );

  const option = (
    value: string | undefined,
    text: string,
    icon: string | undefined,
    allowed: boolean
  ) => {
    const selected = selectedProvider === value;
    return (
      <button
        key={value ?? 'auto'}
        type="button"
        className="provider-option"
        aria-pressed={selected}
        disabled={!allowed}
        onClick={() => onSelect(value)}
      >
        <IonChip color={selected ? 'primary' : 'medium'} outline={!selected} disabled={!allowed}>
          {icon && <IonIcon icon={icon} aria-hidden="true" />}
          <IonLabel>{text}</IonLabel>
        </IonChip>
      </button>
    );
  };

  return (
    <div className="provider-selector">
      <p id={label} className="provider-selector__label">
        Upload to:
      </p>
      <div role="group" aria-labelledby={label} className="provider-selector__options">
        {option(undefined, 'Auto', undefined, true)}
        {offered.map((provider) => {
          const info = PROVIDER_INFO[provider];
          const allowed = allowedProviders.includes(provider);
          return option(provider, info.label, allowed ? info.icon : lockClosedOutline, allowed);
        })}
      </div>
    </div>
  );
};

export default ProviderSelector;
