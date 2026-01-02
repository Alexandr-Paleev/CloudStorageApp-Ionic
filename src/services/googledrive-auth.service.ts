import { supabase } from '../supabase/supabase.config';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient: any = null;
let accessToken: string | null = null;

const googleDriveAuthService = {
    /**
     * Initialize Google Identity Services
     */
    async initialize(): Promise<void> {
        if (typeof window === 'undefined') return;

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: SCOPES,
                    callback: (response: any) => {
                        if (response.error !== undefined) {
                            console.error('Google Auth Error:', response);
                        }
                        accessToken = response.access_token;
                        localStorage.setItem('gdrive_access_token', response.access_token);
                        resolve();
                    },
                });
                resolve();
            };
            document.head.appendChild(script);
        });
    },

    /**
     * Request access token
     */
    async authorize(): Promise<string> {
        if (!tokenClient) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            tokenClient.callback = (response: any) => {
                if (response.error !== undefined) {
                    reject(response);
                    return;
                }
                accessToken = response.access_token;
                localStorage.setItem('gdrive_access_token', response.access_token);
                resolve(response.access_token);
            };
            tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    },

    /**
     * Get current access token (from Supabase session or fallback)
     */
    async getAccessToken(): Promise<string | null> {
        // 1. Try to get provider_token from Supabase session
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.provider_token) {
            return session.provider_token;
        }

        // 2. Fallback to local storage or memory
        return accessToken || localStorage.getItem('gdrive_access_token');
    },

    /**
     * Check if authorized
     */
    async isAuthorized(): Promise<boolean> {
        const token = await this.getAccessToken();
        return !!token;
    },

    /**
     * Logout from Google
     */
    logout(): void {
        const token = this.getAccessToken();
        if (token) {
            (window as any).google.accounts.oauth2.revoke(token, () => {
                console.log('Token revoked');
            });
        }
        accessToken = null;
        localStorage.removeItem('gdrive_access_token');
    },
};

export default googleDriveAuthService;
