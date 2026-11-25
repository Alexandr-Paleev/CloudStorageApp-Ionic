import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IonButton, IonText } from '@ionic/react';
import assistantsService from '../services/assistants.service';
import { formatDate } from '../utils/format.utils';

/**
 * The assistants this account let read its files (ADR 0020), each with a way
 * to take that back. Revoking ends the assistant's sessions and refresh
 * tokens at Supabase, and `/mcp` asks Supabase about every token, so its
 * next request is refused.
 *
 * Shown only when Supabase answers with a list: until its OAuth server is
 * turned on there is none (null), and a card saying an error would only say
 * that.
 */
const Assistants: React.FC = () => {
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryKey: ['assistants'],
    queryFn: () => assistantsService.grants(),
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: (clientId: string) => assistantsService.revoke(clientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assistants'] }),
  });

  if (!grants.data) return null;

  return (
    <section className="account-card" aria-labelledby="account-assistants">
      <h2 className="account-heading" id="account-assistants">
        Assistants
      </h2>
      {grants.data.length === 0 ? (
        <p className="account-note">
          No assistant can read your files. One you add Cloud Storage to asks here first.
        </p>
      ) : (
        <>
          <p className="account-note">
            These can list, search and read your files, and ask questions of them. None can change
            or share one.
          </p>
          <ul className="account-assistants">
            {grants.data.map((grant) => (
              <li key={grant.clientId} className="account-assistant">
                <span className="account-assistant-name" data-hj-suppress="">
                  {grant.name || 'An unnamed assistant'}
                  <span className="account-since"> · since {formatDate(grant.grantedAt)}</span>
                </span>
                <IonButton
                  size="small"
                  fill="clear"
                  color="danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(grant.clientId)}
                >
                  Revoke
                </IonButton>
              </li>
            ))}
          </ul>
        </>
      )}
      {revoke.isError && (
        <IonText color="danger">
          <p className="account-note" role="alert">
            {revoke.error instanceof Error
              ? revoke.error.message
              : 'Could not revoke the assistant’s access.'}
          </p>
        </IonText>
      )}
    </section>
  );
};

export default Assistants;
