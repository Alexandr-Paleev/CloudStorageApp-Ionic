import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IonButton, IonIcon, IonSpinner, IonText } from '@ionic/react';
import { closeCircleOutline, linkOutline } from 'ionicons/icons';
import shareService, { type ShareLinkRecord } from '../services/share.service';
import { formatDateTime } from '../utils/format.utils';
import './ShareLinks.css';

type LinkState = 'active' | 'revoked' | 'expired';

/**
 * Mirrors shareUnusableReason() in lib/share.ts rather than importing it: that
 * module pulls in node:crypto for token generation, which has no place in the
 * browser bundle.
 */
function stateOf(link: ShareLinkRecord): LinkState {
  if (link.revoked_at) return 'revoked';
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

const LABELS: Record<LinkState, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};

interface Props {
  fileId: string;
}

/**
 * The links created for one file, with a way to revoke them.
 *
 * Rows come straight from the table — RLS scopes them to the owner and the
 * token itself is never stored, so there is nothing secret to leak here. A
 * link cannot be shown again after creation; it can only be revoked.
 */
const ShareLinks: React.FC<Props> = ({ fileId }) => {
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ['shareLinks', fileId],
    queryFn: () => shareService.listLinks(fileId),
    enabled: !!fileId,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => shareService.revokeLink(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shareLinks', fileId] }),
  });

  if (isLoading) {
    return (
      <div className="share-links share-links--loading">
        <IonSpinner name="dots" aria-label="Loading share links" />
      </div>
    );
  }

  if (!links || links.length === 0) return null;

  return (
    <div className="share-links">
      <IonText>
        <h3 className="share-links__title">
          <IonIcon icon={linkOutline} aria-hidden="true" /> Share links
        </h3>
      </IonText>

      <ul className="share-links__list">
        {links.map((link) => {
          const state = stateOf(link);
          return (
            <li key={link.id} className={`share-links__item share-links__item--${state}`}>
              <div className="share-links__info">
                <span className={`share-links__badge share-links__badge--${state}`}>
                  {LABELS[state]}
                </span>
                <span className="share-links__dates">
                  created {formatDateTime(link.created_at)}
                  {link.expires_at && state === 'active' && (
                    <> · expires {formatDateTime(link.expires_at)}</>
                  )}
                </span>
              </div>

              {state === 'active' && (
                <IonButton
                  size="small"
                  fill="clear"
                  color="danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(link.id)}
                >
                  <IonIcon icon={closeCircleOutline} slot="start" aria-hidden="true" />
                  Revoke
                </IonButton>
              )}
            </li>
          );
        })}
      </ul>

      {revoke.isError && (
        <IonText color="danger">
          <p className="share-links__error">
            {revoke.error instanceof Error ? revoke.error.message : 'Failed to revoke link'}
          </p>
        </IonText>
      )}
    </div>
  );
};

export default ShareLinks;
